import Capacitor
import Foundation
import WidgetKit

/// App-local Capacitor plugin behind the Home Screen / Lock Screen widgets
/// (ios/App/ZenWidgets). The WebView publishes the widget snapshot
/// (src/bridge/widgets.ts builds it from the store) and this writes it into
/// the App Group — the only place a widget extension can read — then asks
/// WidgetKit to re-render. The extension never sees the vault itself.
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "ZenWidgets"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumeLaunchLink", returnType: CAPPluginReturnPromise)
    ]

    private let appGroupId = "group.md.zennotes"
    /// Mirrored by WidgetSnapshotStore.relativePath in the extension.
    private let snapshotPath = "widgets/snapshot.json"

    /// The latest zennotes:// link this process was opened with, for the
    /// WebView to consume at boot (deep-links.ts). SceneDelegate stashes every
    /// URL open here; the newest wins. Same contract as the Android plugin,
    /// where it exists because Capacitor's getLaunchUrl can be stale for a
    /// recreated activity — kept on both so the shell code stays shared.
    private static var pendingLaunchLink: String?

    static func stashLaunchLink(_ url: URL) {
        guard url.scheme?.lowercased() == "zennotes" else { return }
        pendingLaunchLink = url.absoluteString
    }

    @objc func consumeLaunchLink(_ call: CAPPluginCall) {
        let link = Self.pendingLaunchLink
        Self.pendingLaunchLink = nil
        call.resolve(["url": link ?? NSNull()])
    }

    private func snapshotURL() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupId)?
            .appendingPathComponent(snapshotPath)
    }

    @objc func update(_ call: CAPPluginCall) {
        guard let json = call.getString("snapshot"), !json.isEmpty else {
            call.reject("snapshot is required")
            return
        }
        DispatchQueue.global(qos: .utility).async {
            guard let url = self.snapshotURL() else {
                call.reject("The App Group container is unavailable.")
                return
            }
            do {
                try FileManager.default.createDirectory(
                    at: url.deletingLastPathComponent(), withIntermediateDirectories: true
                )
                // Atomic: a widget waking mid-write must see the old snapshot
                // or the new one, never a truncated file.
                try Data(json.utf8).write(to: url, options: .atomic)
            } catch {
                call.reject("Could not write the widget snapshot: \(error.localizedDescription)")
                return
            }
            WidgetCenter.shared.reloadAllTimelines()
            call.resolve()
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .utility).async {
            if let url = self.snapshotURL() {
                try? FileManager.default.removeItem(at: url)
            }
            WidgetCenter.shared.reloadAllTimelines()
            call.resolve()
        }
    }
}
