import CryptoKit
import Foundation

/// Runs the native ZNE1 chunk loop against the shared vectors. The vectors
/// file is a verbatim copy of docs/specs/cloud-e2ee-vectors.json in the
/// desktop repo: refresh it from there, never by hand.
@main
enum Zne1FileCipherTests {
    enum Failure: Error { case assertion(String) }
    struct Vector: Decodable {
        let plaintextLength: Int
        let headerHex: String
        let objectKeyHex: String
        let aadHex: String
        let ciphertextLength: Int
        let ciphertextSha256: String
        let ciphertextHex: String?
    }
    struct Vectors: Decodable { let objects: [Vector]; let metadataObject: Vector }

    static func check(_ value: Bool, _ message: String) throws {
        if !value { throw Failure.assertion(message) }
    }
    static func sha(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
    static func bytes(_ hex: String) -> Data {
        var data = Data()
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            data.append(UInt8(hex[index..<next], radix: 16)!)
            index = next
        }
        return data
    }
    /// The vectors' plaintext: byte i is i mod 251.
    static func plaintext(_ length: Int) -> Data {
        Data((0..<length).map { UInt8($0 % 251) })
    }
    static func parameters(_ vector: Vector, header: Data? = nil, key: Data? = nil, aad: Data? = nil) throws -> Zne1FileCipher.Parameters {
        guard let parameters = Zne1FileCipher.Parameters(header: header ?? bytes(vector.headerHex),
                                                         objectKey: key ?? bytes(vector.objectKeyHex),
                                                         aad: aad ?? bytes(vector.aadHex)) else {
            throw Failure.assertion("Vector parameters refused")
        }
        return parameters
    }

    static func main() throws {
        guard CommandLine.arguments.count == 2 else { throw Failure.assertion("Pass the path of cloud-e2ee-vectors.json") }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let vectors = try decoder.decode(Vectors.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
        func vector(_ length: Int) throws -> Vector {
            guard let found = vectors.objects.first(where: { $0.plaintextLength == length }) else {
                throw Failure.assertion("No \(length)-byte vector")
            }
            return found
        }
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("zne1-file-cipher-tests-\(UUID().uuidString)")
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }

        // Known answers: every content object and the item-metadata object,
        // sealed from a real file and opened back.
        var sealedObjects: [Int: Data] = [:]
        for (number, vector) in (vectors.objects + [vectors.metadataObject]).enumerated() {
            let label = "\(vector.plaintextLength)-byte vector"
            let plain = plaintext(vector.plaintextLength)
            let source = root.appendingPathComponent("plain-\(number)")
            let sealedFile = root.appendingPathComponent("sealed/\(number)")
            try plain.write(to: source)
            let sealed = try Zne1FileCipher.encrypt(InputStream(url: source)!, to: sealedFile, with: parameters(vector))
            let ciphertext = try Data(contentsOf: sealedFile)
            try check(sealed.byteLength == vector.ciphertextLength && ciphertext.count == vector.ciphertextLength,
                      "\(label): ciphertext length")
            try check(sealed.sha256 == vector.ciphertextSha256 && sha(ciphertext) == vector.ciphertextSha256,
                      "\(label): ciphertext SHA-256")
            try check(vector.ciphertextHex.map { hex(ciphertext) == $0 } ?? true, "\(label): ciphertext bytes")
            try check(sealed.plaintextByteLength == plain.count && sealed.plaintextSha256 == sha(plain),
                      "\(label): plaintext length and SHA-256")
            let openedFile = root.appendingPathComponent("opened/\(number)")
            let opened = try Zne1FileCipher.decrypt(InputStream(url: sealedFile)!, to: openedFile, with: parameters(vector))
            try check(opened.byteLength == plain.count && opened.sha256 == sha(plain), "\(label): opened length and SHA-256")
            try check(try Data(contentsOf: openedFile) == plain, "\(label): opened bytes")

            // Short reads must not move a chunk boundary on either side.
            for step in [1, 4_093, 65_535] {
                let resealed = try Zne1FileCipher.encrypt(TrickleStream(plain, step: step),
                                                          to: root.appendingPathComponent("resealed"), with: parameters(vector))
                try check(resealed.sha256 == vector.ciphertextSha256, "\(label): \(step)-byte reads changed the ciphertext")
                let reopened = try Zne1FileCipher.decrypt(TrickleStream(ciphertext, step: step),
                                                          to: root.appendingPathComponent("reopened"), with: parameters(vector))
                try check(reopened.sha256 == sha(plain), "\(label): \(step)-byte reads changed the plaintext")
            }
            sealedObjects[vector.plaintextLength] = ciphertext
        }

        // Tampering. The 200000-byte object has three full chunks and a
        // 3392-byte last chunk; the 131072-byte object ends on a full chunk.
        let content = try parameters(vector(200_000))
        let large = sealedObjects[200_000]!
        let even = sealedObjects[131_072]!
        let header = Zne1FileCipher.headerSize
        let sealedChunk = Zne1FileCipher.sealedChunkSize
        let tamperedSource = root.appendingPathComponent("tampered")
        let tamperedOutput = root.appendingPathComponent("tampered-out")
        var refusals = 0
        func refuses(_ expected: Zne1FileCipher.Failure, _ label: String, _ data: Data,
                     _ parameters: Zne1FileCipher.Parameters? = nil) throws {
            try data.write(to: tamperedSource)
            do {
                _ = try Zne1FileCipher.decrypt(InputStream(url: tamperedSource)!, to: tamperedOutput, with: parameters ?? content)
            } catch let failure as Zne1FileCipher.Failure {
                try check(failure == expected, "\(label): expected \(expected), got \(failure)")
                try check(!fm.fileExists(atPath: tamperedOutput.path), "\(label): partial plaintext left behind")
                refusals += 1
                return
            }
            throw Failure.assertion("\(label): opened")
        }
        func flipped(_ data: Data, at offset: Int) -> Data {
            var copy = data
            copy[offset] ^= 0x01
            return copy
        }

        // A flipped bit in every chunk's ciphertext and tag.
        let chunkStarts = Array(stride(from: header, to: large.count, by: sealedChunk))
        for (index, start) in chunkStarts.enumerated() {
            try refuses(.tampered, "Flipped ciphertext bit in chunk \(index)", flipped(large, at: start))
            try refuses(.tampered, "Flipped tag bit in chunk \(index)", flipped(large, at: min(start + sealedChunk, large.count) - 1))
        }
        // A flipped bit in every header field: the file no longer begins with
        // the header JavaScript checked.
        for (field, offset) in [("magic", 0), ("algorithm", 4), ("purpose", 5), ("key version", 9), ("salt", 10), ("commitment", 73)] {
            try refuses(.tampered, "Flipped \(field) bit", flipped(large, at: offset))
        }
        // Truncation at and between chunk boundaries.
        for boundary in chunkStarts.dropFirst() {
            try refuses(.tampered, "Truncated at the chunk boundary at \(boundary)", large.prefix(boundary))
        }
        try refuses(.tampered, "Truncated last chunk", large.dropLast())
        try refuses(.malformed, "A partial tag after a full chunk", large.prefix(header + sealedChunk + 16))
        try refuses(.malformed, "Less than a tag as the only chunk", large.prefix(header + 15))
        try refuses(.malformed, "Header only", large.prefix(header))
        try refuses(.malformed, "Shorter than a header", large.prefix(header - 1))
        try refuses(.malformed, "Empty file", Data())
        // Appended bytes.
        try refuses(.tampered, "One byte appended", large + [0])
        try refuses(.tampered, "A sealed chunk appended", large + large[header..<header + sealedChunk])
        try refuses(.malformed, "One byte after a final full chunk", even + [0])
        try refuses(.malformed, "A tag's length after a final full chunk", even + Data(count: 16))
        try refuses(.tampered, "Seventeen bytes after a final full chunk", even + Data(count: 17))
        // Reordered chunks.
        var swapped = large
        swapped.replaceSubrange(header..<header + sealedChunk, with: large[header + sealedChunk..<header + 2 * sealedChunk])
        swapped.replaceSubrange(header + sealedChunk..<header + 2 * sealedChunk, with: large[header..<header + sealedChunk])
        try refuses(.tampered, "Swapped chunks", swapped)
        // The wrong header, key or AAD.
        let metadata = vectors.metadataObject
        try refuses(.tampered, "Another object's header", large, parameters(vector(200_000), header: bytes(metadata.headerHex)))
        try refuses(.tampered, "Wrong object key", large, parameters(vector(200_000), key: bytes(metadata.objectKeyHex)))
        try refuses(.tampered, "Wrong AAD", large, parameters(vector(200_000), aad: bytes(metadata.aadHex)))

        // An empty last chunk after a full one authenticates, so only the
        // length rule can refuse it. Hand-seal it with an independently built
        // nonce; the same construction with one byte in the last chunk must
        // reproduce the 65537-byte vector, so the forgery itself is sound.
        func handSealed(_ chunks: [Data], _ vector: Vector) throws -> Data {
            var out = bytes(vector.headerHex)
            for (index, chunk) in chunks.enumerated() {
                var nonce = Data(count: 12)
                nonce[10] = UInt8(index)
                nonce[11] = index == chunks.count - 1 ? 0x01 : 0x00
                let box = try AES.GCM.seal(chunk, using: SymmetricKey(data: bytes(vector.objectKeyHex)),
                                           nonce: AES.GCM.Nonce(data: nonce), authenticating: bytes(vector.aadHex))
                out += box.ciphertext + box.tag
            }
            return out
        }
        let split = plaintext(65_537)
        try check(try handSealed([split.prefix(65_536), split.suffix(1)], vector(65_537)) == sealedObjects[65_537],
                  "Hand-sealed chunks differ from the 65537-byte vector")
        try refuses(.malformed, "An empty last chunk after a full one",
                    handSealed([split.prefix(65_536), Data()], vector(65_537)), parameters(vector(65_537)))

        // Parameters the native loop refuses before touching a file.
        let goodHeader = bytes(vectors.objects[0].headerHex)
        let goodKey = bytes(vectors.objects[0].objectKeyHex)
        let goodAad = bytes(vectors.objects[0].aadHex)
        var otherAlgorithm = goodHeader
        otherAlgorithm[4] = 0x02
        var notZne1 = goodHeader
        notZne1[0] = 0x00
        for (label, header, key, aad) in [
            ("a short header", goodHeader.prefix(73), goodKey, goodAad),
            ("a long header", goodHeader + [0], goodKey, goodAad),
            ("another algorithm", otherAlgorithm, goodKey, goodAad),
            ("a header without the magic", notZne1, goodKey, goodAad),
            ("a short key", goodHeader, goodKey.prefix(31), goodAad),
            ("a long AAD", goodHeader, goodKey, goodAad + [0])
        ] {
            try check(Zne1FileCipher.Parameters(header: header, objectKey: key, aad: aad) == nil, "Accepted \(label)")
        }

        // I/O failures are never reported as bad data and leave no output,
        // including plaintext of chunks that opened before the failure.
        let unreadOutput = root.appendingPathComponent("unread")
        func failsToRead(_ label: String, _ operation: () throws -> Void) throws {
            do {
                try operation()
            } catch is Zne1FileCipher.Failure {
                throw Failure.assertion("\(label): reported as bad data")
            } catch {
                try check(!fm.fileExists(atPath: unreadOutput.path), "\(label): output left behind")
                return
            }
            throw Failure.assertion("\(label): succeeded")
        }
        let missing = root.appendingPathComponent("missing")
        try failsToRead("Encrypting a missing file") {
            _ = try Zne1FileCipher.encrypt(InputStream(url: missing)!, to: unreadOutput, with: content)
        }
        try failsToRead("Decrypting a missing file") {
            _ = try Zne1FileCipher.decrypt(InputStream(url: missing)!, to: unreadOutput, with: content)
        }
        try failsToRead("A read failing partway through encryption") {
            _ = try Zne1FileCipher.encrypt(TrickleStream(plaintext(200_000), step: 4_096, failAfter: 140_000),
                                           to: unreadOutput, with: content)
        }
        try failsToRead("A read failing partway through decryption") {
            _ = try Zne1FileCipher.decrypt(TrickleStream(large, step: 4_096, failAfter: 140_000), to: unreadOutput, with: content)
        }

        // readHeader hands JavaScript a file's first bytes: the header of a
        // sealed file, the whole file when it is shorter, an error when absent.
        try sealedObjects[200_000]!.write(to: tamperedSource)
        try check(try CloudFileStream.head(tamperedSource, length: header) == bytes(vector(200_000).headerHex),
                  "readHeader did not return the ZNE1 header")
        try sealedObjects[0]!.write(to: tamperedSource)
        try check(try CloudFileStream.head(tamperedSource, length: 4_096) == sealedObjects[0]!,
                  "readHeader of a short file did not return all of it")
        do {
            _ = try CloudFileStream.head(missing, length: header)
            throw Failure.assertion("readHeader of a missing file succeeded")
        } catch Failure.assertion(let message) {
            throw Failure.assertion(message)
        } catch {}

        print("Native ZNE1 cipher: \(sealedObjects.count) vectors sealed and opened, \(refusals) tampered inputs refused")
    }
}

/// Hands out at most `step` bytes per read, as a stream may before its end,
/// and fails every read once `failAfter` bytes have gone out.
final class TrickleStream: InputStream {
    private let data: Data
    private let step: Int
    private let failAfter: Int
    private var offset = 0

    init(_ data: Data, step: Int, failAfter: Int = .max) {
        self.data = data
        self.step = step
        self.failAfter = failAfter
        super.init(data: Data())
    }

    override func open() {}
    override func close() {}
    override var streamStatus: Stream.Status { offset >= failAfter ? .error : offset < data.count ? .open : .atEnd }
    override var streamError: Error? { offset >= failAfter ? CocoaError(.fileReadUnknown) : nil }
    override var hasBytesAvailable: Bool { offset < data.count }
    override func read(_ buffer: UnsafeMutablePointer<UInt8>, maxLength len: Int) -> Int {
        if offset >= failAfter { return -1 }
        let count = min(step, len, data.count - offset)
        data.copyBytes(to: buffer, from: data.startIndex + offset..<data.startIndex + offset + count)
        offset += count
        return count
    }
    override func getBuffer(_ buffer: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>,
                            length len: UnsafeMutablePointer<Int>) -> Bool { false }
}
