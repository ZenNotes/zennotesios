import Foundation

/// The Calendar widget's checkbox taps (src/bridge/widget-calendar.ts
/// `WidgetAction`), kept in the App Group until the app has applied them.
///
/// The extension cannot reach the vault (on-device vaults live in the app's
/// Documents, iCloud vaults in the ubiquity container), so it never writes a
/// note: a tap is logged here and drawn ticked at once, and the app applies
/// it through app-core's own toggle the next time it runs. The log is what
/// keeps the box ticked until then; a snapshot whose `calendar.actionsAck`
/// covers a tap is what clears it, so a snapshot built before the app saw
/// the tap never undoes the tick on screen.
///
/// Compiled into both the widget extension (it appends) and the app
/// (WidgetBridgePlugin reads and prunes); NSFileCoordinator keeps the two
/// processes from writing over each other.
enum WidgetActionLog {
    static let appGroupId = "group.md.zennotes"
    static let relativePath = "widgets/actions.json"
    /// A tap the app never got to must not grow the log forever.
    private static let maxActions = 200

    static var url: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupId)?
            .appendingPathComponent(relativePath)
    }

    private static func decode(_ url: URL) -> [[String: Any]] {
        guard let data = try? Data(contentsOf: url),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return [] }
        return list
    }

    private static func encode(_ list: [[String: Any]], to url: URL) {
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        guard let data = try? JSONSerialization.data(withJSONObject: list) else { return }
        try? data.write(to: url, options: .atomic)
    }

    static func read() -> [[String: Any]] {
        guard let url else { return [] }
        var list: [[String: Any]] = []
        var error: NSError?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &error) { list = decode($0) }
        return list
    }

    private static func update(_ change: (inout [[String: Any]]) -> Void) {
        guard let url else { return }
        var error: NSError?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forMerging, error: &error) { url in
            var list = decode(url)
            change(&list)
            encode(list, to: url)
        }
    }

    /// The newest `at` ever handed out. Kept beside the log because the log
    /// can be pruned empty: a clock set back after that would otherwise give
    /// a new tap an `at` the app has already acked, and it would be pruned
    /// unapplied.
    private static let lastAtKey = "widgetActions.lastAt"

    /// Append a tap; its `at` (ms) is set here, above every earlier one.
    static func append(_ action: [String: Any]) {
        update { list in
            let defaults = UserDefaults(suiteName: appGroupId)
            var at = (Date().timeIntervalSince1970 * 1000).rounded()
            let floor = max(list.last?["at"] as? Double ?? 0, defaults?.double(forKey: lastAtKey) ?? 0)
            if at <= floor { at = floor + 1 }
            defaults?.set(at, forKey: lastAtKey)
            var entry = action
            entry["at"] = at
            list.append(entry)
            if list.count > maxActions { list.removeFirst(list.count - maxActions) }
        }
    }

    /// Drop every tap the app has applied (`at <= ack`).
    static func prune(through ack: Double) {
        guard ack > 0 else { return }
        update { list in list.removeAll { ($0["at"] as? Double ?? 0) <= ack } }
    }

    /// The log as JSON, for WidgetBridgePlugin.readActions.
    static func json() -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: read()) else { return "[]" }
        return String(decoding: data, as: UTF8.self)
    }

    /// Task id -> the state its latest tap in `vaultKey` asked for.
    static func marks(vaultKey: String) -> [String: Bool] {
        var out: [String: Bool] = [:]
        for action in read() where action["vaultKey"] as? String == vaultKey {
            if let id = action["id"] as? String, let checked = action["checked"] as? Bool { out[id] = checked }
        }
        return out
    }
}
