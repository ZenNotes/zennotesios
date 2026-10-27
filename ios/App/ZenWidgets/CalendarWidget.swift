import AppIntents
import SwiftUI
import WidgetKit

/// The Calendar widget: app-core's Calendar sheet on the Home Screen (Dave,
/// Discord 2026-10-27). The month grid with its writing dots, open-task
/// marks and week numbers on top, the selected day's tasks below with boxes
/// to tick.
///
/// A widget cannot scroll, so the list pages instead: the large size lists
/// the selected day and pages by day, the extra-large portrait size (iOS 27)
/// lists the selected week and pages by week. Like the panel on a touch
/// screen, a tap selects a day and a tap on the selected day opens its daily
/// note. "Add a task for …" opens the Calendar in the app with the cursor in
/// its field (a widget holds no text field). Ticks are logged for the app
/// (WidgetActionLog), which writes them into the note through app-core.
/// Buttons need iOS 17; on 15 and 16 every part is a link into the app.
struct CalendarWidget: Widget {
    static let kind = "md.zennotes.widgets.calendar"

    private static var families: [WidgetFamily] {
        if #available(iOS 27.0, *) { return [.systemLarge, .systemExtraLargePortrait] }
        return [.systemLarge]
    }

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: CalendarProvider()) { entry in
            CalendarWidgetView(entry: entry)
        }
        .configurationDisplayName("Calendar")
        .description("The month, with each day's tasks to tick off.")
        .supportedFamilies(Self.families)
        .contentMarginsDisabled()
    }
}

// MARK: - Calendar arithmetic (the panel's grid, lib/calendar-data.ts)

enum CalendarGrid {
    /// The panel's weekday labels (it uppercases them in CSS).
    static let dayLabels = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

    static func addDays(_ iso: String, _ days: Int) -> String {
        guard let date = CalendarWidgetState.date(iso),
              let moved = CalendarWidgetState.isoCalendar.date(byAdding: .day, value: days, to: date) else { return iso }
        return CalendarWidgetState.iso(moved)
    }

    /// 0 = Sunday … 6 = Saturday, as the snapshot's `weekStart`.
    static func weekday(_ iso: String) -> Int {
        guard let date = CalendarWidgetState.date(iso) else { return 0 }
        return CalendarWidgetState.isoCalendar.component(.weekday, from: date) - 1
    }

    /// The 42 days of `month`'s grid starting on `weekStart` (buildGrid).
    static func grid(month: String, weekStart: Int) -> [String] {
        let first = month + "-01"
        let start = addDays(first, -((weekday(first) - weekStart + 7) % 7))
        return (0..<42).map { addDays(start, $0) }
    }

    /// The 7 days of the week holding `iso`, from `weekStart` (the agenda).
    static func week(of iso: String, weekStart: Int) -> [String] {
        let start = addDays(iso, -((weekday(iso) - weekStart + 7) % 7))
        return (0..<7).map { addDays(start, $0) }
    }

    /// The day a grid row's week number comes from: its Monday, else its first day.
    static func rowMonday(_ row: [String]) -> String {
        row.first { weekday($0) == 1 } ?? row[0]
    }

    private static var isoCalendar: Calendar {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = .current
        return calendar
    }

    static func isoWeek(_ iso: String) -> Int {
        guard let date = CalendarWidgetState.date(iso) else { return 0 }
        return isoCalendar.component(.weekOfYear, from: date)
    }

    /// `2026-W44`: how the snapshot keys weekly notes.
    static func isoWeekKey(_ iso: String) -> String {
        guard let date = CalendarWidgetState.date(iso) else { return "" }
        let parts = isoCalendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: date)
        return String(format: "%d-W%02d", parts.yearForWeekOfYear ?? 0, parts.weekOfYear ?? 0)
    }

    private static func format(_ iso: String, _ template: String) -> String {
        guard let date = CalendarWidgetState.date(iso) else { return iso }
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter.string(from: date)
    }

    /// "October 2026".
    static func monthLabel(_ month: String) -> String { format(month + "-01", "MMMMy") }

    /// "27 Tue", the panel's `{ weekday: 'short', day: 'numeric' }`.
    static func shortDay(_ iso: String) -> String { format(iso, "dEEE") }

    /// "Oct 26 – Nov 1", or "Oct 5 – 11" within one month (the panel's label).
    static func weekRange(_ week: [String]) -> String {
        let start = week[0], end = week[6]
        let endLabel = start.prefix(7) == end.prefix(7) ? format(end, "d") : format(end, "MMMd")
        return "\(format(start, "MMMd")) \u{2013} \(endLabel)"
    }
}

// MARK: - Timeline

struct CalendarEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    let palette: WidgetPalette
    /// `YYYY-MM` in the grid and the selected `YYYY-MM-DD`.
    let month: String
    let selected: String
    /// Task id -> the state a tap the app has yet to apply asked for.
    let marks: [String: Bool]
}

struct CalendarProvider: TimelineProvider {
    func placeholder(in context: Context) -> CalendarEntry {
        entry(WidgetSnapshotStore.sample(), now: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (CalendarEntry) -> Void) {
        let real = WidgetSnapshotStore.load()
        let snapshot = context.isPreview && real?.calendar == nil ? WidgetSnapshotStore.sample() : real
        completion(entry(snapshot, now: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CalendarEntry>) -> Void) {
        let now = Date()
        // Today's ring and a stale selection move at midnight; the app
        // reloads on every change in between.
        let midnight = Calendar.current.nextDate(
            after: now, matching: DateComponents(hour: 0, minute: 0, second: 5), matchingPolicy: .nextTime
        ) ?? now.addingTimeInterval(6 * 3600)
        completion(Timeline(entries: [entry(WidgetSnapshotStore.load(), now: now)], policy: .after(midnight)))
    }

    private func entry(_ snapshot: WidgetSnapshot?, now: Date) -> CalendarEntry {
        let state = CalendarWidgetState.load(today: WidgetFormat.isoDate(now))
        let key = snapshot?.calendar?.vaultKey ?? ""
        return CalendarEntry(
            date: now, snapshot: snapshot, palette: WidgetPalette(theme: snapshot?.theme),
            month: state.month, selected: state.selected,
            marks: key.isEmpty ? [:] : WidgetActionLog.marks(vaultKey: key)
        )
    }
}

// MARK: - View

struct CalendarWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: CalendarEntry

    private var cal: WidgetCalendarData? { entry.snapshot?.calendar }
    private var large: Bool { family == .systemLarge }
    private var today: String { WidgetFormat.isoDate(entry.date) }
    private var weekStart: Int { cal?.weekStart ?? 1 }
    private var daily: Bool { cal?.dailyEnabled == true }
    private var weekNumbers: Bool { cal?.showWeekNumbers == true }
    private var cellHeight: CGFloat { large ? 19 : 27 }
    private var rowHeight: CGFloat { large ? 22 : 25 }
    private var weekColumn: CGFloat { large ? 18 : 22 }
    /// The panel's faint ink for days outside the month and week numbers.
    private var faint: Color { entry.palette.muted.opacity(0.55) }

    var body: some View {
        let p = entry.palette
        VStack(spacing: 0) {
            header(p)
            labels(p)
            grid(p)
            Rectangle().fill(p.bg2).frame(height: 1).padding(.vertical, large ? 4 : 7)
            if daily {
                agendaBar(p)
                addField(p)
                agenda(p)
            } else {
                emptyState(p)
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 9)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .calendarBackground(p.bg)
        .widgetURL(ZenLinks.calendar(date: entry.selected))
    }

    // Header: ‹ month ›. The label returns to the current month, as in the panel.
    private func header(_ p: WidgetPalette) -> some View {
        HStack(spacing: 0) {
            pageButton(months: -1, symbol: "chevron.left", p)
            Spacer(minLength: 4)
            monthLabel(p)
            Spacer(minLength: 4)
            pageButton(months: 1, symbol: "chevron.right", p)
        }
        .frame(height: large ? 20 : 26)
    }

    @ViewBuilder
    private func monthLabel(_ p: WidgetPalette) -> some View {
        let label = Text(CalendarGrid.monthLabel(entry.month))
            .font(.system(size: large ? 13 : 15, weight: .semibold))
            .foregroundColor(p.fg)
        if #available(iOS 17.0, *) {
            Button(intent: ShowCalendarMonthIntent(delta: 0)) { label }.buttonStyle(.plain)
        } else {
            label
        }
    }

    @ViewBuilder
    private func pageButton(months: Int, symbol: String, _ p: WidgetPalette) -> some View {
        if #available(iOS 17.0, *) {
            Button(intent: ShowCalendarMonthIntent(delta: months)) { chevron(symbol, p) }.buttonStyle(.plain)
        } else {
            Color.clear.frame(width: 26, height: 20)
        }
    }

    private func chevron(_ symbol: String, _ p: WidgetPalette) -> some View {
        Image(systemName: symbol)
            .font(.system(size: large ? 11 : 13, weight: .semibold))
            .foregroundColor(p.muted)
            .frame(width: 26, height: large ? 20 : 26)
            .contentShape(Rectangle())
    }

    private func labels(_ p: WidgetPalette) -> some View {
        HStack(spacing: 0) {
            if weekNumbers { Text("W").frame(width: weekColumn) }
            ForEach(0..<7, id: \.self) { i in
                Text(CalendarGrid.dayLabels[(weekStart + i) % 7]).frame(maxWidth: .infinity)
            }
        }
        .font(.system(size: large ? 8.5 : 10, weight: .medium))
        .foregroundColor(p.muted)
        .frame(height: large ? 12 : 15)
    }

    private func grid(_ p: WidgetPalette) -> some View {
        let days = CalendarGrid.grid(month: entry.month, weekStart: weekStart)
        return VStack(spacing: 0) {
            ForEach(0..<6, id: \.self) { r in
                let row = Array(days[(r * 7)..<(r * 7 + 7)])
                HStack(spacing: 0) {
                    if weekNumbers { weekCell(CalendarGrid.rowMonday(row), p) }
                    ForEach(row, id: \.self) { iso in dayCell(iso, p) }
                }
            }
        }
    }

    private func dayCell(_ iso: String, _ p: WidgetPalette) -> some View {
        let inMonth = iso.hasPrefix(entry.month)
        let selected = daily && iso == entry.selected
        let isToday = iso == today
        let color: Color = selected ? p.fg : isToday ? p.accent : inMonth ? p.fg : faint
        let number = String(Int(iso.suffix(2)) ?? 0)
        return tappableDay(iso, selected: selected) {
            cell(number, color: color, selected: selected, today: isToday, mark: cal?.days?[iso], p)
        }
    }

    private func weekCell(_ monday: String, _ p: WidgetPalette) -> some View {
        let weekly = cal?.weeklyEnabled == true
        let content = cell(String(CalendarGrid.isoWeek(monday)), color: faint, selected: false, today: false,
                           mark: weekly ? cal?.weeks?[CalendarGrid.isoWeekKey(monday)] : nil, p)
            .frame(width: weekColumn)
        return Group {
            if weekly {
                Link(destination: ZenLinks.week(monday)) { content }
            } else {
                content
            }
        }
    }

    /// One cell as CalendarPanel draws it: selected = fill + ring, today =
    /// ring, dots for the note's words, a corner mark for its open tasks.
    private func cell(_ text: String, color: Color, selected: Bool, today: Bool,
                      mark: WidgetCalendarMark?, _ p: WidgetPalette) -> some View {
        ZStack(alignment: .topTrailing) {
            RoundedRectangle(cornerRadius: 5).fill(selected ? p.bg2 : Color.clear)
            if selected || today {
                RoundedRectangle(cornerRadius: 5).strokeBorder(p.accent.opacity(selected ? 0.6 : 0.5), lineWidth: 1)
            }
            VStack(spacing: large ? 1 : 2) {
                Text(text)
                    .font(.system(size: large ? 11 : 13, weight: selected || today ? .semibold : .regular))
                    .foregroundColor(color)
                dots(mark, p)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            if (mark?.openTasks ?? 0) > 0 {
                Circle().fill(p.accent).frame(width: 4, height: 4).padding(large ? 2 : 3)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: cellHeight)
        .padding(.horizontal, 1)
    }

    private func dots(_ mark: WidgetCalendarMark?, _ p: WidgetPalette) -> some View {
        HStack(spacing: 1.5) {
            ForEach(0..<max(0, min(3, mark?.dots ?? 0)), id: \.self) { _ in
                Circle().fill(p.muted).frame(width: 2.5, height: 2.5)
            }
        }
        .opacity(mark?.faint == true ? 0.4 : 1)
        .frame(height: 3)
    }

    /// Select a day (iOS 17), or open the selected one; before iOS 17 a tap
    /// opens the Calendar on that day in the app.
    @ViewBuilder
    private func tappableDay<Content: View>(_ iso: String, selected: Bool,
                                            @ViewBuilder _ content: () -> Content) -> some View {
        if cal == nil {
            Link(destination: ZenLinks.calendar(date: nil)) { content() }
        } else if !daily {
            content()
        } else if selected {
            Link(destination: ZenLinks.day(iso)) { content() }
        } else if #available(iOS 17.0, *) {
            Button(intent: SelectCalendarDayIntent(day: iso)) { content() }.buttonStyle(.plain)
        } else {
            Link(destination: ZenLinks.calendar(date: iso)) { content() }
        }
    }

    // The bar over the list: the large size lists one day, the extra-large a week.
    private func agendaBar(_ p: WidgetPalette) -> some View {
        let week = CalendarGrid.week(of: entry.selected, weekStart: weekStart)
        let title = large
            ? CalendarGrid.shortDay(entry.selected)
            : "Week of \(CalendarGrid.weekRange(week))"
        let hasDay = cal?.days?[entry.selected] != nil
        return HStack(spacing: 4) {
            Text(title)
                .font(.system(size: large ? 12 : 13, weight: .semibold))
                .foregroundColor(p.fg)
                .lineLimit(1)
            if large && entry.selected == today { todayBadge(p) }
            Spacer(minLength: 4)
            if #available(iOS 17.0, *) {
                Button(intent: ShiftCalendarDaysIntent(days: large ? -1 : -7)) { chevron("chevron.left", p) }
                    .buttonStyle(.plain)
                Button(intent: ShiftCalendarDaysIntent(days: large ? 1 : 7)) { chevron("chevron.right", p) }
                    .buttonStyle(.plain)
            }
            Link(destination: ZenLinks.day(entry.selected)) {
                Text(hasDay ? "Day \u{2192}" : "Day +")
                    .font(.system(size: large ? 11 : 12))
                    .foregroundColor(p.muted)
            }
            if cal?.weeklyEnabled == true {
                let hasWeek = cal?.weeks?[CalendarGrid.isoWeekKey(entry.selected)] != nil
                Link(destination: ZenLinks.week(entry.selected)) {
                    Text(hasWeek ? "Week \u{2192}" : "Week +")
                        .font(.system(size: large ? 11 : 12))
                        .foregroundColor(p.muted)
                }
                .padding(.leading, 4)
            }
        }
        .frame(height: large ? 20 : 26)
    }

    private func todayBadge(_ p: WidgetPalette) -> some View {
        Text("Today")
            .font(.system(size: large ? 9.5 : 10.5, weight: .medium))
            .foregroundColor(p.accent)
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(RoundedRectangle(cornerRadius: 3).fill(p.accent.opacity(0.15)))
    }

    private func addField(_ p: WidgetPalette) -> some View {
        Link(destination: ZenLinks.calendar(date: entry.selected, add: true)) {
            HStack {
                Text("Add a task for \(CalendarGrid.shortDay(entry.selected))\u{2026}")
                    .font(.system(size: large ? 11.5 : 13))
                    .foregroundColor(p.muted)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .frame(height: large ? 24 : 30)
            .background(RoundedRectangle(cornerRadius: 6).fill(p.bg2.opacity(0.6)))
        }
        .padding(.top, 2)
        .padding(.bottom, large ? 2 : 4)
    }

    // MARK: Agenda rows

    private struct Row: Identifiable {
        enum Kind { case header, task, message }
        let id: String
        let kind: Kind
        let iso: String
        var task: WidgetCalendarTask?
        var count = 0
    }

    private func rows() -> [Row] {
        guard let cal else { return [] }
        let week = CalendarGrid.week(of: entry.selected, weekStart: weekStart)
        let days = large ? [entry.selected] : week
        guard days.allSatisfy({ cal.covers($0) }) else {
            return [Row(id: "message", kind: .message, iso: entry.selected)]
        }
        var out: [Row] = []
        for iso in days {
            let day = cal.agenda?[iso]
            if !large { out.append(Row(id: "h\(iso)", kind: .header, iso: iso, count: day?.total ?? 0)) }
            for task in day?.tasks ?? [] {
                out.append(Row(id: "t\(task.id)", kind: .task, iso: iso, task: task))
            }
        }
        if large && out.isEmpty {
            out.append(Row(id: "none", kind: .message, iso: entry.selected, count: -1))
        }
        return out
    }

    private func agenda(_ p: WidgetPalette) -> some View {
        GeometryReader { geo in
            let all = rows()
            let fit = max(1, Int(geo.size.height / rowHeight))
            let shown = all.count > fit ? Array(all.prefix(fit - 1)) : all
            VStack(alignment: .leading, spacing: 0) {
                ForEach(shown) { row in agendaRow(row, p) }
                if all.count > fit {
                    let hidden = all.dropFirst(fit - 1).filter { $0.kind == .task }.count
                    Link(destination: ZenLinks.calendar(date: entry.selected)) {
                        Text("+\(hidden) more")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(p.muted)
                            .frame(height: rowHeight, alignment: .leading)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    @ViewBuilder
    private func agendaRow(_ row: Row, _ p: WidgetPalette) -> some View {
        switch row.kind {
        case .header:
            dayHeader(row, p)
        case .task:
            if let task = row.task { taskRow(task, p) }
        case .message:
            Link(destination: ZenLinks.calendar(date: row.iso)) {
                Text(row.count < 0 ? "Nothing due \(CalendarGrid.shortDay(row.iso))." : "Open ZenNotes to see this week.")
                    .font(.system(size: 11.5))
                    .foregroundColor(p.muted)
                    .frame(height: rowHeight, alignment: .leading)
            }
        }
    }

    @ViewBuilder
    private func dayHeader(_ row: Row, _ p: WidgetPalette) -> some View {
        let label = HStack(spacing: 5) {
            Text(CalendarGrid.shortDay(row.iso).uppercased())
                .font(.system(size: 10.5, weight: .semibold))
                .kerning(0.4)
                .foregroundColor(row.iso == entry.selected ? p.fg : p.muted)
            if row.iso == today { todayBadge(p) }
            Spacer(minLength: 4)
            if row.count > 0 {
                Text("\(row.count)").font(.system(size: 10.5)).foregroundColor(p.muted)
            }
        }
        .frame(height: rowHeight)
        .contentShape(Rectangle())
        if #available(iOS 17.0, *) {
            Button(intent: SelectCalendarDayIntent(day: row.iso)) { label }.buttonStyle(.plain)
        } else {
            label
        }
    }

    private func taskRow(_ task: WidgetCalendarTask, _ p: WidgetPalette) -> some View {
        let checked = entry.marks[task.id] ?? false
        return HStack(spacing: 6) {
            checkbox(task, checked: checked, p)
            Link(destination: ZenLinks.task(id: task.id, path: task.path)) {
                HStack(spacing: 4) {
                    Text(task.content)
                        .font(.system(size: large ? 12 : 13))
                        .foregroundColor(checked ? p.muted : p.fg)
                        .strikethrough(checked, color: p.muted)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if task.inDailyNote != true {
                        Text(task.noteTitle)
                            .font(.system(size: large ? 10 : 11))
                            .foregroundColor(p.muted)
                            .lineLimit(1)
                    }
                }
            }
        }
        .frame(height: rowHeight)
    }

    @ViewBuilder
    private func checkbox(_ task: WidgetCalendarTask, checked: Bool, _ p: WidgetPalette) -> some View {
        // A Button, not a Toggle: a widget Toggle held its in-between state
        // over the reloaded row on iOS 27, so the tick never showed. The
        // reload after the tap draws the box from the log instead.
        if #available(iOS 17.0, *) {
            if let key = cal?.vaultKey {
                Button(intent: ToggleCalendarTaskIntent(
                    checked: !checked, taskID: task.id, path: task.path, line: task.line, raw: task.raw,
                    toggled: task.toggled ?? "", vaultKey: key
                )) {
                    CalendarCheckBox.box(checked: checked, palette: p, compact: large)
                }
                .buttonStyle(.plain)
            } else {
                CalendarCheckBox.box(checked: checked, palette: p, compact: large)
            }
        } else {
            CalendarCheckBox.box(checked: checked, palette: p, compact: large)
        }
    }

    @ViewBuilder
    private func emptyState(_ p: WidgetPalette) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(cal == nil ? "Open ZenNotes once" : "Daily notes are off")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(p.fg)
            Text(cal == nil ? "The calendar fills in from your vault." : "Turn them on in ZenNotes to list tasks by day.")
                .font(.system(size: 11.5))
                .foregroundColor(p.muted)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 4)
    }
}

/// The agenda's checkbox. A tick waits for the app (nothing is written from
/// the widget), so a ticked box is drawn in the muted color until the app
/// has applied it and the task leaves the list.
enum CalendarCheckBox {
    static func box(checked: Bool, palette: WidgetPalette, compact: Bool) -> some View {
        Image(systemName: checked ? "checkmark.square.fill" : "square")
            .font(.system(size: compact ? 14 : 16))
            .foregroundColor(palette.muted)
            .frame(width: compact ? 20 : 24, height: compact ? 20 : 24)
            .contentShape(Rectangle())
    }
}

private extension View {
    /// The system container from iOS 17 (content margins are off: the grid
    /// needs the room), a plain background before.
    @ViewBuilder
    func calendarBackground(_ color: Color) -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(for: .widget) { color }
        } else {
            self.background(color)
        }
    }
}
