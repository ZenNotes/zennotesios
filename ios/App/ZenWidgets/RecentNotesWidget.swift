import SwiftUI
import WidgetKit

/// Pinned notes first, then the ones edited last — the Home dashboard's
/// Recent list with the drawer's pins on top. Every row opens its note; the
/// header's + starts a new one.
struct RecentNotesEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    let palette: WidgetPalette
}

struct RecentNotesProvider: TimelineProvider {
    /// The "3h ago" stamps drift with no app activity at all, so one
    /// timeline re-renders the same snapshot a few times over the next
    /// hours; a real change reloads everything from the app.
    private static let refreshOffsetsMinutes: [Double] = [0, 5, 15, 30, 60, 120, 240, 480]

    func placeholder(in context: Context) -> RecentNotesEntry {
        RecentNotesEntry(date: Date(), snapshot: WidgetSnapshotStore.sample(), palette: .fallback)
    }

    func getSnapshot(in context: Context, completion: @escaping (RecentNotesEntry) -> Void) {
        let real = WidgetSnapshotStore.load()
        // The gallery should show a lived-in widget, not an empty vault.
        let snapshot = (context.isPreview && (real?.notes.isEmpty ?? true))
            ? WidgetSnapshotStore.sample()
            : real
        completion(RecentNotesEntry(date: Date(), snapshot: snapshot, palette: WidgetPalette(theme: real?.theme)))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<RecentNotesEntry>) -> Void) {
        let now = Date()
        let snapshot = WidgetSnapshotStore.load()
        let palette = WidgetPalette(theme: snapshot?.theme)
        let entries = Self.refreshOffsetsMinutes.map { offset in
            RecentNotesEntry(date: now.addingTimeInterval(offset * 60), snapshot: snapshot, palette: palette)
        }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

struct RecentNotesWidget: Widget {
    static let kind = "md.zennotes.widgets.recent-notes"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: RecentNotesProvider()) { entry in
            RecentNotesWidgetView(entry: entry)
        }
        .configurationDisplayName("Recent Notes")
        .description("Your pinned notes, then the ones you edited last.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct RecentNotesWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: RecentNotesEntry

    private var isLarge: Bool { family == .systemLarge }
    private var maxRows: Int { isLarge ? 9 : 4 }
    private var rowHeight: CGFloat { isLarge ? 30 : 22 }

    var body: some View {
        let p = entry.palette
        let notes = Array((entry.snapshot?.notes ?? []).prefix(maxRows))
        VStack(alignment: .leading, spacing: 0) {
            header(p)
            if notes.isEmpty {
                emptyState(p)
            } else {
                ForEach(Array(notes.enumerated()), id: \.element.id) { index, note in
                    Link(destination: ZenLinks.open(note.path)) {
                        row(note, p)
                    }
                    if index < notes.count - 1 {
                        Rectangle().fill(p.bg2).frame(height: 0.5)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .zenWidgetBackground(p.bg)
        .widgetURL(ZenLinks.home)
    }

    private func header(_ p: WidgetPalette) -> some View {
        HStack(spacing: 6) {
            Image("Enso")
                .resizable()
                .scaledToFit()
                .frame(width: 16, height: 16)
            Text(entry.snapshot?.vaultName ?? "ZenNotes")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(p.muted)
                .lineLimit(1)
            Spacer(minLength: 8)
            Link(destination: ZenLinks.newNote) {
                ZStack {
                    Circle().fill(p.accent.opacity(0.18))
                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(p.accent)
                }
                .frame(width: 22, height: 22)
            }
        }
        .frame(height: 22)
        .padding(.bottom, 4)
    }

    private func row(_ note: WidgetNote, _ p: WidgetPalette) -> some View {
        HStack(spacing: 8) {
            Image(systemName: note.pinned ? "pin.fill" : "doc.text")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(note.pinned ? p.accent : p.muted)
                .frame(width: 14)
            Text(note.title)
                .font(.system(size: isLarge ? 14 : 13, weight: .medium))
                .foregroundColor(p.fg)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text(WidgetFormat.timeAgo(note.updatedDate, now: entry.date))
                .font(.system(size: 11))
                .foregroundColor(p.muted)
                .lineLimit(1)
        }
        .frame(height: rowHeight)
        .contentShape(Rectangle())
    }

    private func emptyState(_ p: WidgetPalette) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Spacer(minLength: 0)
            Text(entry.snapshot == nil ? "Open ZenNotes once" : "No notes yet")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(p.fg)
            Text(entry.snapshot == nil ? "The widget fills in from your vault." : "Tap + to write your first.")
                .font(.system(size: 12))
                .foregroundColor(p.muted)
            Spacer(minLength: 0)
        }
    }
}
