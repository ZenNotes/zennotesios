import Capacitor
import Foundation

/// Native file transfer for Cloud sync. Large vault files never cross the
/// WebView bridge: this plugin fingerprints them in place, copies them between
/// vault paths, and streams signed revision downloads to disk with length and
/// SHA-256 verified before anything is published. Same jsName and method shapes
/// as the Android ZenDirectUpload plugin so src/bridge/*.ts stays shared.
@objc(CloudFilesPlugin)
public class CloudFilesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CloudFilesPlugin"
    public let jsName = "ZenDirectUpload"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "inspect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "copy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "put", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "md.zennotes.cloud-files", qos: .utility)

    @objc func inspect(_ call: CAPPluginCall) {
        guard let uri = call.getString("uri"), let url = Self.vaultFileURL(uri) else {
            call.reject("Invalid vault file URI.", "INVALID_URI")
            return
        }
        let textCandidate = call.getBool("textCandidate") ?? false
        queue.async {
            do {
                let result = try CloudFileStream.fingerprint(url, textCandidate: textCandidate)
                var payload: [String: Any] = [
                    "uri": uri,
                    "byteLength": result.byteLength,
                    "sha256": result.sha256,
                    "utf8": result.utf8
                ]
                if let inline = result.inline { payload["inlineBase64"] = inline.base64EncodedString() }
                call.resolve(payload)
            } catch {
                call.reject("Cloud file inspection failed.", "CLOUD_FILE_READ_FAILED", error)
            }
        }
    }

    @objc func copy(_ call: CAPPluginCall) {
        guard let from = call.getString("from").flatMap(Self.vaultFileURL),
              let to = call.getString("to").flatMap(Self.vaultFileURL),
              let expected = Self.expectation(call), from != to else {
            call.reject("Invalid Cloud copy request.", "INVALID_COPY_REQUEST")
            return
        }
        queue.async {
            do {
                guard let input = InputStream(url: from) else { throw CloudFileError.unreadable }
                try CloudFileStream.copyVerified(input, to: to, expected: expected)
                call.resolve()
            } catch {
                try? FileManager.default.removeItem(at: to)
                call.reject("Cloud file copy failed.", "CLOUD_FILE_COPY_FAILED", error)
            }
        }
    }

    /// Streams a signed GET into a vault staging file. Redirects are refused,
    /// no account bearer is ever attached, and a mismatched length or hash
    /// removes the partial file and rejects.
    @objc func download(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString),
              let to = call.getString("to").flatMap(Self.vaultFileURL),
              let expected = Self.expectation(call), Self.allowed(url) else {
            call.reject("Invalid Cloud download request.", "INVALID_DOWNLOAD_REQUEST")
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 300
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        for (name, value) in call.getObject("headers") ?? [:] {
            guard let value = value as? String,
                  CloudFileStream.allowedHeader(name, value: value, url: url) else {
                call.reject("Invalid signed download header.", "INVALID_DOWNLOAD_REQUEST")
                return
            }
            request.setValue(value, forHTTPHeaderField: name)
        }
        let delegate = NoRedirectDelegate()
        let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
        let task = session.downloadTask(with: request) { location, response, error in
            defer { session.finishTasksAndInvalidate() }
            if let error = error {
                call.reject("Cloud object download failed.", "DIRECT_DOWNLOAD_FAILED", error)
                return
            }
            guard let http = response as? HTTPURLResponse, let location = location else {
                call.reject("Cloud object download failed.", "DIRECT_DOWNLOAD_FAILED")
                return
            }
            guard (200..<300).contains(http.statusCode) else {
                call.reject("Cloud object download failed (\(http.statusCode)).", "DIRECT_DOWNLOAD_FAILED", nil, ["status": http.statusCode])
                return
            }
            do {
                guard let input = InputStream(url: location) else { throw CloudFileError.unreadable }
                try CloudFileStream.copyVerified(input, to: to, expected: expected)
                call.resolve()
            } catch {
                try? FileManager.default.removeItem(at: to)
                call.reject("Cloud object download failed.", "DIRECT_DOWNLOAD_FAILED", error)
            }
        }
        task.resume()
    }

    /// Streams a vault file to its short-lived signed object URL with a fixed
    /// Content-Length. A private, verified snapshot keeps subsequent local
    /// edits from changing the bytes URLSession transmits.
    @objc func put(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString),
              let source = call.getString("uri").flatMap(Self.vaultFileURL),
              let expected = Self.expectation(call), Self.allowed(url) else {
            call.reject("Invalid direct-upload request.", "INVALID_DIRECT_UPLOAD_REQUEST")
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.timeoutInterval = 300
        request.setValue(String(expected.byteLength), forHTTPHeaderField: "Content-Length")
        var hasType = false
        for (name, value) in call.getObject("headers") ?? [:] {
            guard let value = value as? String, CloudFileStream.allowedHeader(name, value: value, url: url) else {
                call.reject("Invalid signed upload header.", "INVALID_DIRECT_UPLOAD_REQUEST")
                return
            }
            if name.lowercased() == "content-length" {
                guard value == String(expected.byteLength) else {
                    call.reject("Invalid upload length.", "INVALID_DIRECT_UPLOAD_REQUEST")
                    return
                }
            }
            if name.lowercased() == "content-type" { hasType = true }
            request.setValue(value, forHTTPHeaderField: name)
        }
        if !hasType { request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type") }
        queue.async {
            let snapshot = FileManager.default.temporaryDirectory.appendingPathComponent("cloud-upload-\(UUID().uuidString)")
            do {
                guard let input = InputStream(url: source) else { throw CloudFileError.unreadable }
                try CloudFileStream.copyVerified(input, to: snapshot, expected: expected)
            } catch {
                try? FileManager.default.removeItem(at: snapshot)
                call.reject("The upload file changed after its scan.", "DIRECT_UPLOAD_FAILED", error)
                return
            }
            let delegate = NoRedirectDelegate()
            let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
            let task = session.uploadTask(with: request, fromFile: snapshot) { _, response, error in
                defer {
                    try? FileManager.default.removeItem(at: snapshot)
                    session.finishTasksAndInvalidate()
                }
                if let error = error {
                    call.reject("Cloud object upload failed.", "DIRECT_UPLOAD_FAILED", error)
                    return
                }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                call.resolve(["status": status])
            }
            task.resume()
        }
    }

    // MARK: - Streaming helpers

    typealias Expectation = CloudFileStream.Expectation
    typealias CloudFileError = CloudFileStream.Failure

    /// External-folder vault roots whose security scope FolderPickerPlugin has
    /// activated this session. Only these, Documents, and the ubiquity
    /// container may be read or written; "any readable file" would let a
    /// signed PUT exfiltrate preferences or another vault.
    private static var externalVaultRoots: [String] = []
    private static let rootsLock = NSLock()

    static func registerExternalVaultRoot(_ url: URL) {
        rootsLock.lock(); defer { rootsLock.unlock() }
        let path = url.resolvingSymlinksInPath().standardizedFileURL.path
        if !externalVaultRoots.contains(path) { externalVaultRoots.append(path) }
    }

    static func vaultFileURL(_ value: String) -> URL? {
        rootsLock.lock(); let external = externalVaultRoots; rootsLock.unlock()
        let roots = ([
            FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?.appendingPathComponent("ZenNotes"),
            FileManager.default.url(forUbiquityContainerIdentifier: nil)?.appendingPathComponent("Documents/ZenNotes")
        ].compactMap { $0 }) + external.map { URL(fileURLWithPath: $0) }
        return CloudFileStream.confinedURL(value, roots: roots)
    }

    static func expectation(_ call: CAPPluginCall) -> Expectation? {
        guard let number = call.getDouble("byteLength"), number.isFinite,
              number >= 0, number <= 200_000_000, number.rounded(.towardZero) == number,
              let hash = call.getString("sha256"), hash.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { return nil }
        return Expectation(byteLength: Int(number), sha256: hash)
    }

    static func allowed(_ url: URL) -> Bool {
        guard url.user == nil, url.password == nil, url.fragment == nil else { return false }
        if url.scheme == "https" { return true }
        let host = url.host?.lowercased() ?? ""
        return url.scheme == "http" && (host == "localhost" || host == "::1" || host.hasPrefix("127."))
    }
}

final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
