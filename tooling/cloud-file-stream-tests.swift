import CryptoKit
import Foundation

@main
enum CloudFileStreamTests {
    enum Failure: Error { case assertion(String) }
    static func check(_ value: Bool, _ message: String) throws {
        if !value { throw Failure.assertion(message) }
    }
    static func rejects(_ message: String, _ operation: () throws -> Void) throws {
        do { try operation() } catch { return }
        throw Failure.assertion(message)
    }
    static func sha(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func main() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("cloud-file-tests-\(UUID().uuidString)")
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }
        let missing = root.appendingPathComponent("missing")
        try rejects("Missing files must not fingerprint as empty") {
            _ = try CloudFileStream.fingerprint(missing, textCandidate: true)
        }
        let empty = root.appendingPathComponent("empty")
        try Data().write(to: empty)
        let emptyPrint = try CloudFileStream.fingerprint(empty, textCandidate: true)
        try check(emptyPrint.byteLength == 0 && emptyPrint.sha256 == sha(Data()), "Real empty file")
        try rejects("Missing streams must not copy as empty") {
            try CloudFileStream.copyVerified(InputStream(url: missing)!, to: root.appendingPathComponent("copy"),
                expected: .init(byteLength: 0, sha256: sha(Data())))
        }

        for text in ["日本語", "café", "🙂", String(repeating: "a", count: 65_535) + "🙂日本"] {
            let file = root.appendingPathComponent("utf8")
            let bytes = Data(text.utf8)
            try bytes.write(to: file)
            let result = try CloudFileStream.fingerprint(file, textCandidate: true)
            try check(result.utf8 && result.sha256 == sha(bytes), "Valid UTF-8 misclassified")
            for split in 0...min(bytes.count, 8) {
                var validator = Utf8Validator()
                validator.accept(Array(bytes.prefix(split))[...])
                validator.accept(Array(bytes.dropFirst(split))[...])
                try check(validator.finish(), "Split UTF-8 misclassified")
            }
        }
        for bytes: [UInt8] in [[0xC0, 0xAF], [0xED, 0xA0, 0x80], [0xF4, 0x90, 0x80, 0x80], [0xE2, 0x82], [0x80]] {
            var validator = Utf8Validator()
            for byte in bytes { validator.accept([byte][...]) }
            try check(!validator.finish(), "Malformed UTF-8 accepted")
        }

        let bytes = Data((0..<150_007).map { UInt8($0 % 251) })
        let copied = root.appendingPathComponent("verified")
        try CloudFileStream.copyVerified(InputStream(data: bytes), to: copied,
            expected: .init(byteLength: bytes.count, sha256: sha(bytes)))
        try check(try Data(contentsOf: copied) == bytes, "Copy lost bytes across buffer boundaries")
        try rejects("Corrupt content must fail") {
            try CloudFileStream.copyVerified(InputStream(data: bytes), to: copied,
                expected: .init(byteLength: bytes.count, sha256: sha(Data())))
        }

        let vault = root.appendingPathComponent("vault")
        let outside = root.appendingPathComponent("vault-other")
        try fm.createDirectory(at: vault, withIntermediateDirectories: true)
        try fm.createDirectory(at: outside, withIntermediateDirectories: true)
        try fm.createSymbolicLink(at: vault.appendingPathComponent("escape"), withDestinationURL: outside)
        for path in [outside.appendingPathComponent("secret"), vault.appendingPathComponent("escape/new"),
                     vault.appendingPathComponent("../vault-other/secret"), vault] {
            try check(CloudFileStream.confinedURL(path.absoluteString, roots: [vault]) == nil, "Escaping path allowed")
        }
        try check(CloudFileStream.confinedURL(vault.appendingPathComponent("new/file").absoluteString, roots: [vault]) != nil,
            "New file under selected vault denied")
        let url = URL(string: "http://127.0.0.1:19101/object")!
        try check(CloudFileStream.allowedHeader("Host", value: "127.0.0.1:19101", url: url), "Presigned Host header denied")
        for header in [("Host", "other.example.test"), ("Authorization", "Bearer secret"),
                       ("Cookie", "session=secret"), ("X-Test", "value\r\nCookie: secret")] {
            try check(!CloudFileStream.allowedHeader(header.0, value: header.1, url: url), "Unsafe signed header accepted")
        }
        print("Native file integrity, UTF-8, and confinement regressions passed")
    }
}
