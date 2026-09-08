import SwiftUI
import WidgetKit

/// The ZenNotes widget gallery: capture (New Note), pick up where you left
/// off (Recent Notes), and what's due (Today's Tasks). All three render from
/// the snapshot the app publishes into the App Group (WidgetSnapshot.swift)
/// — the extension never touches the vault — and every tap is a
/// `zennotes://` link the shell resolves (src/ui-mobile/deep-links.ts).
@main
struct ZenWidgetsBundle: WidgetBundle {
    var body: some Widget {
        NewNoteWidget()
        RecentNotesWidget()
        TasksWidget()
    }
}
