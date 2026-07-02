import Capacitor
import Foundation

/// iCloud Drive vault tier (mobile spec 03). The vault directory lives in the
/// app's ubiquity container (`iCloud Drive/ZenNotes/<vault>`) and the OS syncs
/// it across devices; on a Mac the same folder appears under
/// `~/Library/Mobile Documents/iCloud~md~zennotes/Documents/`.
///
/// The critical part is placeholder handling: iCloud may evict file content
/// locally, leaving `.name.icloud` stubs. Reading through them as "missing"
/// is the documented Obsidian data-loss illusion — `ensureDownloaded` walks
/// the tree, requests downloads for every stub, and waits (bounded) until the
/// real bytes exist.
@objc(ICloudVaultPlugin)
public class ICloudVaultPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ICloudVaultPlugin"
    public let jsName = "ICloudVault"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ensureDownloaded", returnType: CAPPluginReturnPromise)
    ]

    private let containerId = "iCloud.md.zennotes"
    private let vaultsFolder = "ZenNotes"

    /// Must be called off the main thread (first call can be slow).
    private func vaultsRoot() -> URL? {
        guard let container = FileManager.default.url(forUbiquityContainerIdentifier: containerId)
        else { return nil }
        let root = container.appendingPathComponent("Documents").appendingPathComponent(vaultsFolder)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let root = self.vaultsRoot() else {
                call.resolve(["available": false, "vaults": []])
                return
            }
            let names = (try? FileManager.default.contentsOfDirectory(
                at: root, includingPropertiesForKeys: [.isDirectoryKey],
                options: [.skipsHiddenFiles]
            ))?.filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
                .map { $0.lastPathComponent } ?? []
            call.resolve([
                "available": true,
                "rootUrl": root.absoluteString,
                "vaults": names
            ])
        }
    }

    /// Move a local vault directory into iCloud (Apple's sanctioned migration:
    /// `setUbiquitous` relocates the tree; iCloud then uploads it).
    @objc func enable(_ call: CAPPluginCall) {
        guard let localPath = call.getString("localPath"),
              let name = call.getString("name") else {
            call.reject("localPath and name are required")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            guard let root = self.vaultsRoot() else {
                call.reject("iCloud is not available — sign into iCloud and enable iCloud Drive.")
                return
            }
            let localUrl = URL(fileURLWithPath: localPath)
            let dest = root.appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: dest.path) {
                // A vault with this name already lives in iCloud (e.g. synced
                // from another device) — adopt it instead of overwriting.
                call.resolve(["url": dest.absoluteString, "adopted": true])
                return
            }
            do {
                try FileManager.default.setUbiquitous(true, itemAt: localUrl, destinationURL: dest)
                call.resolve(["url": dest.absoluteString, "adopted": false])
            } catch {
                call.reject("Could not move the vault to iCloud: \(error.localizedDescription)")
            }
        }
    }

    /// Move an iCloud vault back to local-only storage.
    @objc func disable(_ call: CAPPluginCall) {
        guard let name = call.getString("name"),
              let localPath = call.getString("localPath") else {
            call.reject("name and localPath are required")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            guard let root = self.vaultsRoot() else {
                call.reject("iCloud is not available.")
                return
            }
            let src = root.appendingPathComponent(name)
            let dest = URL(fileURLWithPath: localPath)
            if FileManager.default.fileExists(atPath: dest.path) {
                call.reject("A local vault named \"\(name)\" already exists on this device.")
                return
            }
            do {
                try FileManager.default.createDirectory(
                    at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
                try FileManager.default.setUbiquitous(false, itemAt: src, destinationURL: dest)
                call.resolve(["path": dest.path])
            } catch {
                call.reject("Could not move the vault out of iCloud: \(error.localizedDescription)")
            }
        }
    }

    /// Recursively request downloads for evicted items under `url` and wait
    /// (bounded) until none remain. Resolves with the number still pending.
    @objc func ensureDownloaded(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let target = URL(string: urlString) else {
            call.reject("url is required")
            return
        }
        let timeoutMs = call.getInt("timeoutMs") ?? 20000
        DispatchQueue.global(qos: .userInitiated).async {
            let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000)
            var pending = self.requestDownloads(under: target)
            while pending > 0 && Date() < deadline {
                Thread.sleep(forTimeInterval: 0.25)
                pending = self.requestDownloads(under: target)
            }
            call.resolve(["pending": pending])
        }
    }

    /// One pass: request download for every `.name.icloud` stub below `url`;
    /// returns how many stubs remain.
    private func requestDownloads(under url: URL) -> Int {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: url.path, isDirectory: &isDir) else {
            // Only wait when the item is genuinely evicted (a `.name.icloud`
            // stub exists). A file that simply doesn't exist must return 0 —
            // otherwise every optional-file read (vault.json, caches) blocks
            // for the full timeout and boot appears to hang.
            let stub = url.deletingLastPathComponent()
                .appendingPathComponent("." + url.lastPathComponent + ".icloud")
            if fm.fileExists(atPath: stub.path) {
                try? fm.startDownloadingUbiquitousItem(at: url)
                return 1
            }
            return 0
        }
        if !isDir.boolValue {
            return 0
        }
        var pending = 0
        let enumerator = fm.enumerator(at: url, includingPropertiesForKeys: nil)
        while let item = enumerator?.nextObject() as? URL {
            let name = item.lastPathComponent
            if name.hasPrefix(".") && name.hasSuffix(".icloud") {
                pending += 1
                // Request via the intended (logical) URL next to the stub.
                let real = item.deletingLastPathComponent()
                    .appendingPathComponent(String(name.dropFirst().dropLast(7)))
                try? fm.startDownloadingUbiquitousItem(at: real)
            }
        }
        return pending
    }
}
