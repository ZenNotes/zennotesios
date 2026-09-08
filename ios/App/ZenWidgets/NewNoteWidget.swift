import SwiftUI
import WidgetKit

/// One tap → a fresh note in the Inbox, title focused (the ⊕ sheet's "New
/// note"). Small on the Home Screen; circular / rectangular / inline on the
/// Lock Screen from iOS 16.
struct NewNoteEntry: TimelineEntry {
    let date: Date
    let vaultName: String?
    let palette: WidgetPalette
}

struct NewNoteProvider: TimelineProvider {
    func placeholder(in context: Context) -> NewNoteEntry {
        NewNoteEntry(date: Date(), vaultName: "My Vault", palette: .fallback)
    }

    func getSnapshot(in context: Context, completion: @escaping (NewNoteEntry) -> Void) {
        completion(entry(now: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NewNoteEntry>) -> Void) {
        let now = Date()
        // Nothing here drifts with time; the app reloads on vault or theme
        // changes. The long horizon only guards against a missed reload.
        completion(Timeline(entries: [entry(now: now)], policy: .after(now.addingTimeInterval(12 * 3600))))
    }

    private func entry(now: Date) -> NewNoteEntry {
        let snapshot = WidgetSnapshotStore.load()
        return NewNoteEntry(
            date: now,
            vaultName: snapshot?.vaultName,
            palette: WidgetPalette(theme: snapshot?.theme)
        )
    }
}

struct NewNoteWidget: Widget {
    static let kind = "md.zennotes.widgets.new-note"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: NewNoteProvider()) { entry in
            NewNoteWidgetView(entry: entry)
        }
        .configurationDisplayName("New Note")
        .description("Start a new note with one tap.")
        .supportedFamilies(Self.families)
    }

    private static var families: [WidgetFamily] {
        var families: [WidgetFamily] = [.systemSmall]
        if #available(iOS 16.0, *) {
            families += [.accessoryCircular, .accessoryRectangular, .accessoryInline]
        }
        return families
    }
}

struct NewNoteWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: NewNoteEntry

    var body: some View {
        Group {
            switch family {
            case .systemSmall, .systemMedium, .systemLarge, .systemExtraLarge:
                NewNoteSmallView(entry: entry)
            default:
                if #available(iOS 16.0, *) {
                    NewNoteAccessoryView(family: family, vaultName: entry.vaultName)
                        .zenAccessoryBackground()
                } else {
                    NewNoteSmallView(entry: entry)
                }
            }
        }
        .widgetURL(ZenLinks.newNote)
    }
}

private struct NewNoteSmallView: View {
    let entry: NewNoteEntry

    var body: some View {
        let p = entry.palette
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                Image("Enso")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 32, height: 32)
                Spacer(minLength: 0)
                ZStack {
                    Circle().fill(p.accent)
                    Image(systemName: "plus")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(p.bg)
                }
                .frame(width: 30, height: 30)
            }
            Spacer(minLength: 0)
            Text("New note")
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(p.fg)
            Text(entry.vaultName ?? "ZenNotes")
                .font(.system(size: 12))
                .foregroundColor(p.muted)
                .lineLimit(1)
                .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .zenWidgetBackground(p.bg)
    }
}

@available(iOS 16.0, *)
private struct NewNoteAccessoryView: View {
    let family: WidgetFamily
    let vaultName: String?

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 22, weight: .medium))
            }
        case .accessoryRectangular:
            HStack(spacing: 8) {
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 20, weight: .medium))
                VStack(alignment: .leading, spacing: 1) {
                    Text("New note")
                        .font(.headline)
                    Text(vaultName ?? "ZenNotes")
                        .font(.caption)
                        .opacity(0.8)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
        default:
            Label("New note", systemImage: "square.and.pencil")
        }
    }
}
