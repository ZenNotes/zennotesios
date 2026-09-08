import SwiftUI
import WidgetKit

/// The Home dashboard's Today bucket: due today, overdue, and undated open
/// tasks, in the Tasks view's order. A row jumps to the task's line in its
/// note; the header (and any empty space) opens the Tasks view.
struct TasksEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    let palette: WidgetPalette
}

struct TasksProvider: TimelineProvider {
    func placeholder(in context: Context) -> TasksEntry {
        TasksEntry(date: Date(), snapshot: WidgetSnapshotStore.sample(), palette: .fallback)
    }

    func getSnapshot(in context: Context, completion: @escaping (TasksEntry) -> Void) {
        let real = WidgetSnapshotStore.load()
        let snapshot = (context.isPreview && (real?.tasks.isEmpty ?? true))
            ? WidgetSnapshotStore.sample()
            : real
        completion(TasksEntry(date: Date(), snapshot: snapshot, palette: WidgetPalette(theme: real?.theme)))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TasksEntry>) -> Void) {
        let now = Date()
        let snapshot = WidgetSnapshotStore.load()
        let entry = TasksEntry(date: now, snapshot: snapshot, palette: WidgetPalette(theme: snapshot?.theme))
        // Re-render at local midnight so "due today" turns overdue on time;
        // the app reloads on every task change in between.
        let midnight = Calendar.current.nextDate(
            after: now, matching: DateComponents(hour: 0, minute: 0, second: 5), matchingPolicy: .nextTime
        ) ?? now.addingTimeInterval(6 * 3600)
        completion(Timeline(entries: [entry], policy: .after(midnight)))
    }
}

struct TasksWidget: Widget {
    static let kind = "md.zennotes.widgets.tasks"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: TasksProvider()) { entry in
            TasksWidgetView(entry: entry)
        }
        .configurationDisplayName("Today's Tasks")
        .description("What's due today, overdue, or waiting for a date.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct TasksWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TasksEntry

    private var isLarge: Bool { family == .systemLarge }
    private var maxRows: Int { isLarge ? 8 : 3 }
    private var rowHeight: CGFloat { isLarge ? 34 : 30 }

    var body: some View {
        let p = entry.palette
        let todayIso = WidgetFormat.isoDate(entry.date)
        let all = entry.snapshot?.tasks ?? []
        let rows = Array(all.prefix(maxRows))
        let hidden = max(0, (entry.snapshot?.todayCount ?? 0) - rows.count)
        VStack(alignment: .leading, spacing: 0) {
            header(p, todayIso: todayIso)
            if rows.isEmpty {
                emptyState(p)
            } else {
                ForEach(rows) { task in
                    Link(destination: ZenLinks.task(id: task.id, path: task.path)) {
                        row(task, p, todayIso: todayIso)
                    }
                }
                if hidden > 0 && isLarge {
                    Text("+\(hidden) more")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(p.muted)
                        .padding(.top, 4)
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .zenWidgetBackground(p.bg)
        .widgetURL(ZenLinks.tasks)
    }

    private func header(_ p: WidgetPalette, todayIso: String) -> some View {
        let today = entry.snapshot?.todayCount ?? 0
        let overdue = (entry.snapshot?.tasks ?? []).filter { isOverdue($0, todayIso: todayIso) }.count
        let overdueTotal = max(overdue, entry.snapshot?.overdueCount ?? 0)
        return HStack(spacing: 6) {
            Image(systemName: "checkmark.square")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(p.accent)
            Text("Today")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(p.fg)
            Spacer(minLength: 8)
            if overdueTotal > 0 {
                Text("\(overdueTotal) overdue")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(p.red)
            } else if today > 0 {
                Text("\(today) open")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(p.muted)
            }
        }
        .frame(height: 22)
        .padding(.bottom, 4)
    }

    private func isOverdue(_ task: WidgetTask, todayIso: String) -> Bool {
        if let due = task.due { return due < todayIso }
        return task.overdue
    }

    private func row(_ task: WidgetTask, _ p: WidgetPalette, todayIso: String) -> some View {
        let overdue = isOverdue(task, todayIso: todayIso)
        var detail = task.noteTitle
        if overdue, let due = task.due {
            detail = "\(WidgetFormat.shortDate(iso: due)) · \(task.noteTitle)"
        }
        return HStack(spacing: 8) {
            Image(systemName: task.inProgress ? "circle.lefthalf.filled" : "square")
                .font(.system(size: 13, weight: .regular))
                .foregroundColor(overdue ? p.red : p.muted)
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 1) {
                Text(task.content)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(p.fg)
                    .lineLimit(1)
                Text(detail)
                    .font(.system(size: 10.5))
                    .foregroundColor(overdue ? p.red : p.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .frame(height: rowHeight)
        .contentShape(Rectangle())
    }

    private func emptyState(_ p: WidgetPalette) -> some View {
        let ready = entry.snapshot?.tasksReady ?? false
        return VStack(alignment: .leading, spacing: 3) {
            Spacer(minLength: 0)
            if entry.snapshot == nil || !ready {
                Text("Open ZenNotes once")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(p.fg)
                Text("Your tasks show up after the first scan.")
                    .font(.system(size: 12))
                    .foregroundColor(p.muted)
            } else {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(p.accent)
                    Text("All clear")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(p.fg)
                }
                Text("Nothing due today.")
                    .font(.system(size: 12))
                    .foregroundColor(p.muted)
            }
            Spacer(minLength: 0)
        }
    }
}
