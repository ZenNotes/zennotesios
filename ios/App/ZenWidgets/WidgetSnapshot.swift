import Foundation

/// Mirror of src/bridge/widget-snapshot.ts — the app is the writer. Every
/// field a later shell might add or drop decodes as optional, so an older
/// extension never fails on a newer snapshot (and vice versa).
struct WidgetThemeData: Decodable {
    var mode: String?
    var bg: String?
    var bg1: String?
    var bg2: String?
    var fg: String?
    var fg2: String?
    var muted: String?
    var accent: String?
    var red: String?
}

struct WidgetNote: Decodable, Identifiable {
    var id: String { path }
    let path: String
    let title: String
    let folder: String?
    /// ms since epoch.
    let updatedAt: Double
    let pinned: Bool

    var updatedDate: Date { Date(timeIntervalSince1970: updatedAt / 1000) }
}

struct WidgetTask: Decodable, Identifiable {
    let id: String
    let path: String
    let noteTitle: String
    let content: String
    /// ISO YYYY-MM-DD; nil for an undated task.
    let due: String?
    let overdue: Bool
    let inProgress: Bool
    let priority: String?
}

struct WidgetTaskCounts: Decodable {
    let today: Int
    let overdue: Int
}

struct WidgetSnapshot: Decodable {
    let version: Int
    /// ms since epoch.
    let generatedAt: Double
    let vaultName: String?
    let theme: WidgetThemeData?
    let notes: [WidgetNote]
    let tasks: [WidgetTask]
    let taskCounts: WidgetTaskCounts?
    let tasksReady: Bool?

    var generatedDate: Date { Date(timeIntervalSince1970: generatedAt / 1000) }
    var todayCount: Int { taskCounts?.today ?? tasks.count }
    var overdueCount: Int { taskCounts?.overdue ?? tasks.filter { $0.overdue }.count }
}

enum WidgetSnapshotStore {
    static let appGroupId = "group.md.zennotes"
    /// Mirrored by WidgetBridgePlugin.snapshotPath in the app.
    static let relativePath = "widgets/snapshot.json"

    static var url: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupId)?
            .appendingPathComponent(relativePath)
    }

    static func load() -> WidgetSnapshot? {
        guard let url = url, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    /// Gallery previews and placeholders — what a lived-in vault looks like.
    static func sample(now: Date = Date()) -> WidgetSnapshot {
        let ms = now.timeIntervalSince1970 * 1000
        let minute = 60_000.0
        let hour = 3_600_000.0
        let today = WidgetFormat.isoDate(now)
        let yesterday = WidgetFormat.isoDate(now.addingTimeInterval(-86_400))
        return WidgetSnapshot(
            version: 1,
            generatedAt: ms,
            vaultName: "My Vault",
            theme: nil,
            notes: [
                WidgetNote(path: "inbox/Reading list.md", title: "Reading list", folder: "inbox",
                           updatedAt: ms - 25 * minute, pinned: true),
                WidgetNote(path: "inbox/Product ideas.md", title: "Product ideas", folder: "inbox",
                           updatedAt: ms - 3 * hour, pinned: false),
                WidgetNote(path: "inbox/Meeting notes.md", title: "Meeting notes", folder: "inbox",
                           updatedAt: ms - 6 * hour, pinned: false),
                WidgetNote(path: "quick/Grocery run.md", title: "Grocery run", folder: "quick",
                           updatedAt: ms - 26 * hour, pinned: false),
                WidgetNote(path: "inbox/Trip planning.md", title: "Trip planning", folder: "inbox",
                           updatedAt: ms - 2 * 24 * hour, pinned: false),
                WidgetNote(path: "inbox/Weekly review.md", title: "Weekly review", folder: "inbox",
                           updatedAt: ms - 3 * 24 * hour, pinned: false),
                WidgetNote(path: "inbox/Book notes.md", title: "Book notes", folder: "inbox",
                           updatedAt: ms - 4 * 24 * hour, pinned: false),
                WidgetNote(path: "inbox/Recipes.md", title: "Recipes", folder: "inbox",
                           updatedAt: ms - 5 * 24 * hour, pinned: false),
                WidgetNote(path: "inbox/Journal.md", title: "Journal", folder: "inbox",
                           updatedAt: ms - 6 * 24 * hour, pinned: false)
            ],
            tasks: [
                WidgetTask(id: "inbox/Today.md#0", path: "inbox/Today.md", noteTitle: "Today",
                           content: "Reply to the design review", due: today, overdue: false,
                           inProgress: false, priority: nil),
                WidgetTask(id: "inbox/Trip planning.md#2", path: "inbox/Trip planning.md",
                           noteTitle: "Trip planning", content: "Book the October flights",
                           due: yesterday, overdue: true, inProgress: false, priority: "high"),
                WidgetTask(id: "inbox/Product ideas.md#1", path: "inbox/Product ideas.md",
                           noteTitle: "Product ideas", content: "Draft the release notes",
                           due: today, overdue: false, inProgress: true, priority: nil),
                WidgetTask(id: "inbox/Today.md#3", path: "inbox/Today.md", noteTitle: "Today",
                           content: "Call the dentist", due: nil, overdue: false,
                           inProgress: false, priority: nil),
                WidgetTask(id: "inbox/Weekly review.md#0", path: "inbox/Weekly review.md",
                           noteTitle: "Weekly review", content: "Plan next week's focus",
                           due: today, overdue: false, inProgress: false, priority: nil),
                WidgetTask(id: "quick/Grocery run.md#0", path: "quick/Grocery run.md",
                           noteTitle: "Grocery run", content: "Pick up coffee beans",
                           due: nil, overdue: false, inProgress: false, priority: nil)
            ],
            taskCounts: WidgetTaskCounts(today: 6, overdue: 1),
            tasksReady: true
        )
    }
}
