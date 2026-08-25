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
        CAPPluginMethod(name: "ensureDownloaded", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "watch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unwatch", returnType: CAPPluginReturnPromise)
    ]

    private let containerId = "iCloud.md.zennotes"
    private let vaultsFolder = "ZenNotes"

    /// Live metadata query (issue zennotes#675). Its existence is what makes
    /// the iCloud sync daemon actually look for remote changes — the same
    /// nudge browsing the folder in the Files app gives it. Main-thread only.
    private var query: NSMetadataQuery?
    /// Logical paths of items the query has seen with content still inbound.
    /// When one of them turns current, the bytes just landed on disk — that,
    /// not the first sighting, is when the JS side needs to rescan.
    private var inboundPaths = Set<String>()

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

    /// Start the live iCloud watcher (issue zennotes#675). Without a running
    /// NSMetadataQuery the ubiquity daemon has no reason to check this
    /// container for remote changes while the app is open — users had to
    /// visit the Files app to force a sync. The query is container-wide (the
    /// container only ever holds ZenNotes vaults) so vault switches need no
    /// re-watch, and it is idempotent: a second call replaces the first.
    /// Resolves `{ watching: false }` quietly when iCloud is unavailable.
    @objc func watch(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .utility).async {
            guard self.vaultsRoot() != nil else {
                call.resolve(["watching": false])
                return
            }
            DispatchQueue.main.async {
                self.stopQuery()
                let query = NSMetadataQuery()
                query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
                query.predicate = NSPredicate(format: "%K LIKE '*'", NSMetadataItemFSNameKey)
                query.notificationBatchingInterval = 2.0
                NotificationCenter.default.addObserver(
                    self, selector: #selector(self.queryDidGather(_:)),
                    name: .NSMetadataQueryDidFinishGathering, object: query)
                NotificationCenter.default.addObserver(
                    self, selector: #selector(self.queryDidUpdate(_:)),
                    name: .NSMetadataQueryDidUpdate, object: query)
                query.start()
                self.query = query
                call.resolve(["watching": true])
            }
        }
    }

    @objc func unwatch(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopQuery()
            call.resolve()
        }
    }

    private func stopQuery() {
        guard let query = self.query else { return }
        NotificationCenter.default.removeObserver(
            self, name: .NSMetadataQueryDidFinishGathering, object: query)
        NotificationCenter.default.removeObserver(
            self, name: .NSMetadataQueryDidUpdate, object: query)
        query.stop()
        self.query = nil
        self.inboundPaths.removeAll()
    }

    /// Initial gather: kick downloads for anything already pending (files
    /// that changed remotely while the app was closed). No notification —
    /// boot runs its own refresh; the landing updates will notify.
    @objc private func queryDidGather(_ note: Notification) {
        guard let query = self.query else { return }
        query.disableUpdates()
        for case let item as NSMetadataItem in query.results {
            _ = self.trackInbound(item)
        }
        query.enableUpdates()
    }

    /// Live update: classify the batch. Inbound content (new sightings or
    /// just-landed bytes) and remote removals matter to the UI; our own
    /// saves — whose content is local and current from the start — do not.
    @objc private func queryDidUpdate(_ note: Notification) {
        guard let query = self.query else { return }
        query.disableUpdates()
        var shouldNotify = false
        let added = note.userInfo?[NSMetadataQueryUpdateAddedItemsKey] as? [NSMetadataItem] ?? []
        let changed = note.userInfo?[NSMetadataQueryUpdateChangedItemsKey] as? [NSMetadataItem] ?? []
        let removed = note.userInfo?[NSMetadataQueryUpdateRemovedItemsKey] as? [NSMetadataItem] ?? []
        for item in added + changed {
            if self.trackInbound(item) { shouldNotify = true }
        }
        if !removed.isEmpty { shouldNotify = true }
        query.enableUpdates()
        if shouldNotify {
            self.notifyListeners("icloudChanged", data: ["pending": self.inboundPaths.count])
        }
    }

    /// Track one item's download state. Returns true when the item is worth
    /// a rescan: content just landed, or new inbound content was spotted
    /// (and its download requested).
    private func trackInbound(_ item: NSMetadataItem) -> Bool {
        guard let path = item.value(forAttribute: NSMetadataItemPathKey) as? String else {
            return false
        }
        let status = item.value(
            forAttribute: NSMetadataUbiquitousItemDownloadingStatusKey) as? String
        if status == NSMetadataUbiquitousItemDownloadingStatusCurrent {
            // Was inbound, now current: the changed bytes are on disk.
            return self.inboundPaths.remove(path) != nil
        }
        if let url = item.value(forAttribute: NSMetadataItemURLKey) as? URL {
            try? FileManager.default.startDownloadingUbiquitousItem(at: url)
        }
        return self.inboundPaths.insert(path).inserted
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
