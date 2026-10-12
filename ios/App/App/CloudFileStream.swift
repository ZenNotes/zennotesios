import CryptoKit
import Foundation

/// File integrity checks shared by the native plugin and host-side regression tests.
enum CloudFileStream {
    static let bufferSize = 64 * 1024
    static let inlineLimit = 5 * 1024 * 1024
    struct Fingerprint { let byteLength: Int; let sha256: String; let utf8: Bool; let inline: Data? }
    struct Expectation { let byteLength: Int; let sha256: String }
    enum Failure: Error { case unreadable, lengthMismatch, hashMismatch, overflow }

    static func fingerprint(_ url: URL, textCandidate: Bool) throws -> Fingerprint {
        guard let input = InputStream(url: url) else { throw Failure.unreadable }
        input.open(); defer { input.close() }
        guard input.streamStatus != .error else { throw input.streamError ?? Failure.unreadable }
        var hasher = SHA256()
        var length = 0
        var inline: Data? = Data()
        var utf8Check = textCandidate ? Utf8Validator() : nil
        var buffer = [UInt8](repeating: 0, count: bufferSize)
        while true {
            let count = input.read(&buffer, maxLength: buffer.count)
            if count < 0 { throw input.streamError ?? Failure.unreadable }
            if count == 0 { break }
            length += count
            buffer.withUnsafeBufferPointer { hasher.update(bufferPointer: UnsafeRawBufferPointer(UnsafeBufferPointer(rebasing: $0.prefix(count)))) }
            if inline != nil {
                if length <= inlineLimit { inline!.append(buffer, count: count) } else { inline = nil }
            }
            utf8Check?.accept(buffer.prefix(count))
        }
        let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
        return Fingerprint(byteLength: length, sha256: digest, utf8: utf8Check?.finish() ?? false, inline: inline)
    }

    static func copyVerified(_ input: InputStream, to destination: URL, expected: Expectation) throws {
        try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        input.open()
        defer { input.close() }
        guard input.streamStatus != .error else { throw input.streamError ?? Failure.unreadable }
        guard let output = OutputStream(url: destination, append: false) else { throw Failure.unreadable }
        output.open()
        defer { output.close() }
        guard output.streamStatus != .error else { throw output.streamError ?? Failure.unreadable }
        var hasher = SHA256()
        var written = 0
        var buffer = [UInt8](repeating: 0, count: bufferSize)
        while true {
            let count = input.read(&buffer, maxLength: buffer.count)
            if count < 0 { throw input.streamError ?? Failure.unreadable }
            if count == 0 { break }
            written += count
            if written > expected.byteLength { throw Failure.overflow }
            buffer.withUnsafeBufferPointer { hasher.update(bufferPointer: UnsafeRawBufferPointer(UnsafeBufferPointer(rebasing: $0.prefix(count)))) }
            var offset = 0
            while offset < count {
                let out = buffer.withUnsafeBufferPointer {
                    output.write($0.baseAddress!.advanced(by: offset), maxLength: count - offset)
                }
                if out <= 0 { throw output.streamError ?? Failure.unreadable }
                offset += out
            }
        }
        if written != expected.byteLength { throw Failure.lengthMismatch }
        let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
        if digest != expected.sha256 { throw Failure.hashMismatch }
    }

    /// Up to `length` leading bytes of a file: a ZNE1 header for JavaScript to
    /// check before native decryption. A shorter file returns what it has.
    static func head(_ url: URL, length: Int) throws -> Data {
        guard let input = InputStream(url: url) else { throw Failure.unreadable }
        input.open()
        defer { input.close() }
        guard input.streamStatus != .error else { throw input.streamError ?? Failure.unreadable }
        var buffer = [UInt8](repeating: 0, count: length)
        let count = try fill(&buffer, from: input)
        return Data(buffer[..<count])
    }

    /// Reads until `buffer` is full or the input ends. Streams may return
    /// short reads before their end, and chunk boundaries must not move.
    static func fill(_ buffer: inout [UInt8], from input: InputStream) throws -> Int {
        var count = 0
        while count < buffer.count {
            let read = buffer.withUnsafeMutableBufferPointer { input.read($0.baseAddress! + count, maxLength: $0.count - count) }
            if read < 0 { throw input.streamError ?? Failure.unreadable }
            if read == 0 { break }
            count += read
        }
        return count
    }

    static func confinedURL(_ value: String, roots: [URL]) -> URL? {
        guard let url = URL(string: value), url.isFileURL else { return nil }
        guard !url.pathComponents.contains(".."), let resolved = canonicalDestination(url) else { return nil }
        let path = resolved.path
        return roots.contains { root in
            let rootPath = root.resolvingSymlinksInPath().standardizedFileURL.path
            return path.hasPrefix(rootPath.hasSuffix("/") ? rootPath : rootPath + "/")
        } ? resolved : nil
    }

    static func allowedHeader(_ name: String, value: String, url: URL) -> Bool {
        guard name.range(of: "^[A-Za-z0-9-]+$", options: .regularExpression) != nil,
              name.rangeOfCharacter(from: .newlines) == nil,
              value.rangeOfCharacter(from: .newlines) == nil else { return false }
        if name.lowercased() == "host" {
            guard let host = url.host else { return false }
            let authority = host + (url.port.map { ":\($0)" } ?? "")
            return value.lowercased() == authority.lowercased()
        }
        return !["authorization", "proxy-authorization", "cookie", "connection", "transfer-encoding"].contains(name.lowercased())
    }

    private static func canonicalDestination(_ url: URL) -> URL? {
        var ancestor = url.standardizedFileURL
        var missing: [String] = []
        let fm = FileManager.default
        // Foundation does not resolve a symlinked parent when the leaf does
        // not exist. Resolve the nearest existing ancestor before adding it.
        while !fm.fileExists(atPath: ancestor.path) {
            if (try? fm.attributesOfItem(atPath: ancestor.path)[.type]) as? FileAttributeType == .typeSymbolicLink {
                return nil
            }
            guard ancestor.path != "/" else { return nil }
            missing.append(ancestor.lastPathComponent)
            ancestor.deleteLastPathComponent()
        }
        var resolved = ancestor.resolvingSymlinksInPath().standardizedFileURL
        for component in missing.reversed() { resolved.appendPathComponent(component) }
        return resolved
    }
}

/// Incremental UTF-8 validation across chunk boundaries.
struct Utf8Validator {
    private var remaining = 0
    private var lower: UInt8 = 0x80
    private var upper: UInt8 = 0xBF
    private var valid = true

    mutating func accept(_ chunk: ArraySlice<UInt8>) {
        guard valid else { return }
        for byte in chunk {
            if remaining > 0 {
                guard byte >= lower && byte <= upper else { valid = false; return }
                remaining -= 1
                lower = 0x80; upper = 0xBF
            } else {
                switch byte {
                case 0...0x7F: break
                case 0xC2...0xDF: remaining = 1
                case 0xE0: remaining = 2; lower = 0xA0
                case 0xE1...0xEC, 0xEE...0xEF: remaining = 2
                case 0xED: remaining = 2; upper = 0x9F
                case 0xF0: remaining = 3; lower = 0x90
                case 0xF1...0xF3: remaining = 3
                case 0xF4: remaining = 3; upper = 0x8F
                default: valid = false; return
                }
            }
        }
    }

    mutating func finish() -> Bool {
        valid && remaining == 0
    }
}

/// The ZNE1 chunk loop for end-to-end encrypted Cloud vaults
/// (docs/specs/cloud-e2ee.md in the desktop repo). JavaScript derives the
/// object key, builds the 74-byte header, checks its key commitment and
/// computes the AAD; this type only seals and opens 64 KiB chunks and hashes
/// both sides, so no parent key ever reaches native code. The shared
/// cloud-e2ee-vectors.json pins the bytes it must produce, the same bytes as
/// the TypeScript and Android implementations.
enum Zne1FileCipher {
    static let headerSize = 74
    static let chunkSize = 65_536
    static let tagSize = 16
    static let sealedChunkSize = chunkSize + tagSize
    struct Sealed { let byteLength: Int; let sha256: String; let plaintextByteLength: Int; let plaintextSha256: String }
    struct Opened { let byteLength: Int; let sha256: String }
    enum Failure: Error { case malformed, tampered }

    struct Parameters {
        let header: Data
        let key: SymmetricKey
        let aad: Data

        /// Nil unless the header is a ZNE1 header for algorithm 0x01, the only
        /// one this loop implements, and the key and AAD are 32 bytes each.
        init?(header: Data, objectKey: Data, aad: Data) {
            guard header.count == Zne1FileCipher.headerSize, header.starts(with: [0x5A, 0x4E, 0x45, 0x31, 0x01]),
                  objectKey.count == 32, aad.count == 32 else { return nil }
            self.header = header
            self.key = SymmetricKey(data: objectKey)
            self.aad = aad
        }
    }

    /// Writes the header, then every sealed chunk. The last chunk holds 1 to
    /// 65536 bytes, so a full chunk is last only when nothing follows it and
    /// the loop reads one chunk ahead; an empty input seals one empty chunk.
    static func encrypt(_ input: InputStream, to destination: URL, with parameters: Parameters) throws -> Sealed {
        input.open()
        defer { input.close() }
        guard input.streamStatus != .error else { throw input.streamError ?? CloudFileStream.Failure.unreadable }
        return try writing(destination) { output in
            var sealedHasher = SHA256()
            var plainHasher = SHA256()
            var byteLength = 0
            func emit(_ data: Data) throws {
                try write(data, to: output)
                sealedHasher.update(data: data)
                byteLength += data.count
            }
            try emit(parameters.header)
            var current = [UInt8](repeating: 0, count: chunkSize)
            var next = [UInt8](repeating: 0, count: chunkSize)
            var count = try CloudFileStream.fill(&current, from: input)
            var index = 0
            var plaintextByteLength = 0
            while true {
                var nextCount = 0
                if count == chunkSize { nextCount = try CloudFileStream.fill(&next, from: input) }
                let last = nextCount == 0
                let chunk = current[..<count]
                plainHasher.update(data: chunk)
                let box = try AES.GCM.seal(chunk, using: parameters.key, nonce: nonce(index, last: last),
                                           authenticating: parameters.aad)
                try emit(box.ciphertext)
                try emit(box.tag)
                plaintextByteLength += count
                if last { break }
                swap(&current, &next)
                count = nextCount
                index += 1
            }
            return Sealed(byteLength: byteLength, sha256: hex(sealedHasher.finalize()),
                          plaintextByteLength: plaintextByteLength, plaintextSha256: hex(plainHasher.finalize()))
        }
    }

    /// Opens the sealed chunks that follow `parameters.header`. The chunk that
    /// ends the input is the last one, so the loop holds one chunk back. Any
    /// failure removes the partial output: plaintext from a file that did not
    /// authenticate to its end is never left behind.
    static func decrypt(_ input: InputStream, to destination: URL, with parameters: Parameters) throws -> Opened {
        input.open()
        defer { input.close() }
        guard input.streamStatus != .error else { throw input.streamError ?? CloudFileStream.Failure.unreadable }
        var header = [UInt8](repeating: 0, count: headerSize)
        guard try CloudFileStream.fill(&header, from: input) == headerSize else { throw Failure.malformed }
        // The AAD covers the header JavaScript checked, not the file's bytes,
        // so a changed header would otherwise open without complaint.
        guard parameters.header.elementsEqual(header) else { throw Failure.tampered }
        return try writing(destination) { output in
            var plainHasher = SHA256()
            var current = [UInt8](repeating: 0, count: sealedChunkSize)
            var next = [UInt8](repeating: 0, count: sealedChunkSize)
            var count = try CloudFileStream.fill(&current, from: input)
            var index = 0
            var byteLength = 0
            while true {
                var nextCount = 0
                if count == sealedChunkSize { nextCount = try CloudFileStream.fill(&next, from: input) }
                let last = nextCount == 0
                // Every chunk but the last is full. The last carries its tag,
                // and plaintext too unless it is the only chunk, so 16 bytes or
                // fewer after a full chunk is a shape encryption never produces.
                if (last && count < tagSize) || (!last && nextCount <= tagSize) { throw Failure.malformed }
                let plain = try open(current[..<count], index: index, last: last, with: parameters)
                try write(plain, to: output)
                plainHasher.update(data: plain)
                byteLength += plain.count
                if last { break }
                swap(&current, &next)
                count = nextCount
                index += 1
            }
            return Opened(byteLength: byteLength, sha256: hex(plainHasher.finalize()))
        }
    }

    private static func open(_ sealed: ArraySlice<UInt8>, index: Int, last: Bool, with parameters: Parameters) throws -> Data {
        let nonce = try nonce(index, last: last)
        do {
            let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: sealed.dropLast(tagSize), tag: sealed.suffix(tagSize))
            return try AES.GCM.open(box, using: parameters.key, authenticating: parameters.aad)
        } catch {
            throw Failure.tampered
        }
    }

    /// Bytes 0 to 10 are the chunk index as an 11-byte big-endian integer and
    /// byte 11 marks the last chunk. Like the TypeScript reference, the index
    /// stops at 2^32 - 1, so bytes 0 to 6 stay zero.
    private static func nonce(_ index: Int, last: Bool) throws -> AES.GCM.Nonce {
        guard let counter = UInt32(exactly: index) else { throw Failure.malformed }
        var bytes = [UInt8](repeating: 0, count: 12)
        withUnsafeBytes(of: counter.bigEndian) { bytes.replaceSubrange(7..<11, with: $0) }
        bytes[11] = last ? 0x01 : 0x00
        return try AES.GCM.Nonce(data: bytes)
    }

    private static func write(_ data: Data, to output: OutputStream) throws {
        try data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            let bytes = raw.bindMemory(to: UInt8.self)
            var offset = 0
            while offset < bytes.count {
                let written = output.write(bytes.baseAddress! + offset, maxLength: bytes.count - offset)
                if written <= 0 { throw output.streamError ?? CloudFileStream.Failure.unreadable }
                offset += written
            }
        }
    }

    /// Runs `body` against a new file at `destination`, removing the file when
    /// `body` throws.
    private static func writing<T>(_ destination: URL, _ body: (OutputStream) throws -> T) throws -> T {
        try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard let output = OutputStream(url: destination, append: false) else { throw CloudFileStream.Failure.unreadable }
        output.open()
        do {
            guard output.streamStatus != .error else { throw output.streamError ?? CloudFileStream.Failure.unreadable }
            let result = try body(output)
            output.close()
            return result
        } catch {
            output.close()
            try? FileManager.default.removeItem(at: destination)
            throw error
        }
    }

    private static func hex(_ digest: SHA256.Digest) -> String {
        digest.map { String(format: "%02x", $0) }.joined()
    }
}
