import AppIntents
import Foundation

/// What the Calendar widget shows: the month in its grid and the selected
/// day (whose tasks it lists), like the panel's `anchor` and `selectedIso`.
/// One state for every placed Calendar widget (a StaticConfiguration widget
/// has no instance id). A new day starts over on today, the way the panel
/// orients on today when it opens.
enum CalendarWidgetState {
    private static var defaults: UserDefaults? { UserDefaults(suiteName: WidgetActionLog.appGroupId) }
    private static let monthKey = "calendarWidget.month"
    private static let selectedKey = "calendarWidget.selected"
    private static let onKey = "calendarWidget.on"

    /// `YYYY-MM`, `YYYY-MM-DD`.
    static func load(today: String) -> (month: String, selected: String) {
        let d = defaults
        guard d?.string(forKey: onKey) == today,
              let month = d?.string(forKey: monthKey),
              let selected = d?.string(forKey: selectedKey)
        else { return (String(today.prefix(7)), today) }
        return (month, selected)
    }

    static func save(month: String, selected: String, today: String) {
        let d = defaults
        d?.set(today, forKey: onKey)
        d?.set(month, forKey: monthKey)
        d?.set(selected, forKey: selectedKey)
    }

    /// Gregorian in the device's time zone whatever calendar the user reads
    /// in: ISO dates are Gregorian, and a Buddhist or Japanese year here made
    /// every key miss (2569-10-27 for 2026-10-27). Here rather than beside
    /// WidgetFormat because the app compiles this file too.
    static let isoCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return calendar
    }()

    static var today: String { iso(Date()) }

    static func iso(_ date: Date) -> String {
        let parts = isoCalendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 1970, parts.month ?? 1, parts.day ?? 1)
    }

    static func date(_ iso: String) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count >= 2 else { return nil }
        return CalendarWidgetState.isoCalendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts.count > 2 ? parts[2] : 1))
    }

    /// The month label returns to the current month (`delta` 0), as in the panel.
    static func shiftMonth(by delta: Int) {
        let today = today
        let state = load(today: today)
        var month = String(today.prefix(7))
        if delta != 0, let first = date(state.month + "-01"),
           let moved = CalendarWidgetState.isoCalendar.date(byAdding: .month, value: delta, to: first) {
            month = String(iso(moved).prefix(7))
        }
        save(month: month, selected: state.selected, today: today)
    }

    static func select(_ day: String) {
        let today = today
        save(month: load(today: today).month, selected: day, today: today)
    }

    /// Page the task list by days (or a week); the grid follows the day into
    /// its month so the selection stays in view.
    static func shiftSelection(by days: Int) {
        let today = today
        let state = load(today: today)
        guard let current = date(state.selected),
              let moved = CalendarWidgetState.isoCalendar.date(byAdding: .day, value: days, to: current) else { return }
        let selected = iso(moved)
        save(month: String(selected.prefix(7)), selected: selected, today: today)
    }
}

// The widget's buttons. They run in the extension (no app launch) and only
// move the widget's own state or log a tap; the timeline reloads after each.

@available(iOS 17.0, *)
struct ShowCalendarMonthIntent: AppIntent {
    static var title: LocalizedStringResource = "Show Another Month"
    static var isDiscoverable: Bool = false

    @Parameter(title: "Months") var delta: Int

    init() {}
    init(delta: Int) { self.delta = delta }

    func perform() async throws -> some IntentResult {
        CalendarWidgetState.shiftMonth(by: delta)
        return .result()
    }
}

@available(iOS 17.0, *)
struct SelectCalendarDayIntent: AppIntent {
    static var title: LocalizedStringResource = "Show a Day's Tasks"
    static var isDiscoverable: Bool = false

    @Parameter(title: "Day") var day: String

    init() {}
    init(day: String) { self.day = day }

    func perform() async throws -> some IntentResult {
        CalendarWidgetState.select(day)
        return .result()
    }
}

@available(iOS 17.0, *)
struct ShiftCalendarDaysIntent: AppIntent {
    static var title: LocalizedStringResource = "Show Other Days' Tasks"
    static var isDiscoverable: Bool = false

    @Parameter(title: "Days") var days: Int

    init() {}
    init(days: Int) { self.days = days }

    func perform() async throws -> some IntentResult {
        CalendarWidgetState.shiftSelection(by: days)
        return .result()
    }
}

/// A checkbox tap. The note is not touched here: the tap is logged for the
/// app (WidgetActionLog), which ticks the task through app-core next time it
/// opens; the reload after the tap draws the row ticked from that log. The
/// state it asks for is fixed when the row is drawn (the opposite of what the
/// row shows): a widget Toggle left a SetValueIntent's `value` unset, and an
/// intent that then asks for it fails without a word.
@available(iOS 17.0, *)
struct ToggleCalendarTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Tick a Task"
    static var isDiscoverable: Bool = false

    @Parameter(title: "Done") var checked: Bool
    @Parameter(title: "Task") var taskID: String
    @Parameter(title: "Note") var path: String
    @Parameter(title: "Line") var line: Int
    @Parameter(title: "Line text") var raw: String
    @Parameter(title: "Ticked line text") var toggled: String
    @Parameter(title: "Vault") var vaultKey: String

    init() {}

    init(checked: Bool, taskID: String, path: String, line: Int, raw: String, toggled: String, vaultKey: String) {
        self.checked = checked
        self.taskID = taskID
        self.path = path
        self.line = line
        self.raw = raw
        self.toggled = toggled
        self.vaultKey = vaultKey
    }

    func perform() async throws -> some IntentResult {
        WidgetActionLog.append([
            "vaultKey": vaultKey,
            "id": taskID,
            "path": path,
            "line": line,
            "raw": raw,
            "toggled": toggled,
            "checked": checked,
            "written": false
        ])
        return .result()
    }
}
