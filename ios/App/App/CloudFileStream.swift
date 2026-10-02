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
