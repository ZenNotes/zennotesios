import Capacitor
import Foundation

/// App-local Capacitor plugin bridging the Share Extension's App Group inbox
/// to the WebView. `drain()` returns the pending captures and clears them —
/// the caller is responsible for turning them into quick notes.
@objc(ShareInboxPlugin)
public class ShareInboxPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareInboxPlugin"
    public let jsName = "ShareInbox"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "drain", returnType: CAPPluginReturnPromise)
    ]

    private let appGroupId = "group.md.zennotes"
    private let pendingKey = "captures"

    @objc func drain(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: appGroupId) else {
            call.resolve(["captures": []])
            return
        }
        let raw = defaults.string(forKey: pendingKey) ?? "[]"
        defaults.removeObject(forKey: pendingKey)
        let captures = (try? JSONSerialization.jsonObject(with: Data(raw.utf8)))
            as? [[String: Any]] ?? []
        call.resolve(["captures": captures])
    }
}
