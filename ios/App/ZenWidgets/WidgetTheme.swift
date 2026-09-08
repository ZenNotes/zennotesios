import SwiftUI
import WidgetKit

/// The widgets wear the app's active theme: the shell samples the `--z-*`
/// tokens (background, foreground, accent, …) into the snapshot and this
/// resolves them to SwiftUI colors, falling back to ZenNotes' default
/// dark-hard palette before the first publish.
struct WidgetPalette {
    let isDark: Bool
    let bg: Color
    let bg1: Color
    let bg2: Color
    let fg: Color
    let fg2: Color
    let muted: Color
    let accent: Color
    let red: Color

    static let fallback = WidgetPalette(
        isDark: true,
        bg: Color(hex: "#1d2021") ?? .black,
        bg1: Color(hex: "#32302f") ?? .gray,
        bg2: Color(hex: "#3c3836") ?? .gray,
        fg: Color(hex: "#d4be98") ?? .white,
        fg2: Color(hex: "#ddc7a1") ?? .white,
        muted: Color(hex: "#a89984") ?? .gray,
        accent: Color(hex: "#e78a4e") ?? .orange,
        red: Color(hex: "#ea6962") ?? .red
    )
}

extension WidgetPalette {
    init(theme: WidgetThemeData?) {
        let f = WidgetPalette.fallback
        self.init(
            isDark: theme?.mode != "light",
            bg: Color(hex: theme?.bg) ?? f.bg,
            bg1: Color(hex: theme?.bg1) ?? f.bg1,
            bg2: Color(hex: theme?.bg2) ?? f.bg2,
            fg: Color(hex: theme?.fg) ?? f.fg,
            fg2: Color(hex: theme?.fg2) ?? f.fg2,
            muted: Color(hex: theme?.muted) ?? f.muted,
            accent: Color(hex: theme?.accent) ?? f.accent,
            red: Color(hex: theme?.red) ?? f.red
        )
    }
}

extension Color {
    /// `#rrggbb` (the hash optional) → sRGB color; anything else is nil.
    init?(hex: String?) {
        guard var text = hex?.trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
        if text.hasPrefix("#") { text.removeFirst() }
        guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
        self.init(
            .sRGB,
            red: Double((value >> 16) & 0xff) / 255,
            green: Double((value >> 8) & 0xff) / 255,
            blue: Double(value & 0xff) / 255,
            opacity: 1
        )
    }
}

enum WidgetFormat {
    /// The Home dashboard's stamp: just now, 5m ago, 3h ago, yesterday,
    /// 4d ago, then a short date.
    static func timeAgo(_ date: Date, now: Date) -> String {
        let minutes = Int((now.timeIntervalSince(date) / 60).rounded())
        if minutes < 1 { return "just now" }
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = Int((Double(minutes) / 60).rounded())
        if hours < 24 { return "\(hours)h ago" }
        let days = Int((Double(hours) / 24).rounded())
        if days == 1 { return "yesterday" }
        if days < 7 { return "\(days)d ago" }
        return shortDate(date)
    }

    /// Local calendar day as ISO YYYY-MM-DD — the form task `due` uses, so
    /// overdue is a plain string comparison.
    static func isoDate(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 1970, parts.month ?? 1, parts.day ?? 1)
    }

    static func shortDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("MMM d")
        return formatter.string(from: date)
    }

    /// "Sep 5" for an ISO due date; the raw string if it doesn't parse.
    static func shortDate(iso: String) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: iso) else { return iso }
        return shortDate(date)
    }
}

/// The `zennotes://` links the shell runs (src/ui-mobile/widget-links.ts is
/// the parser and the source of truth for the vocabulary).
enum ZenLinks {
    static let newNote = URL(string: "zennotes://new")!
    static let tasks = URL(string: "zennotes://tasks")!
    static let home = URL(string: "zennotes://home")!

    static func open(_ path: String) -> URL {
        URL(string: "zennotes://open?path=\(encode(path))") ?? home
    }

    static func task(id: String, path: String) -> URL {
        URL(string: "zennotes://task?id=\(encode(id))&path=\(encode(path))") ?? open(path)
    }

    /// Only unreserved characters stay bare: `#` in task ids and `&` in
    /// titles would otherwise split the URL.
    private static let unreserved = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
    )

    private static func encode(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
    }
}

extension View {
    /// iOS 17 draws widgets inside a system container (margins included);
    /// earlier releases get the same look from a plain background + padding.
    @ViewBuilder
    func zenWidgetBackground(_ color: Color) -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(for: .widget) { color }
        } else {
            self
                .padding(16)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(color)
        }
    }

    /// Lock Screen accessories render vibrant on the system's own material;
    /// iOS 17 still wants a container background declared.
    @ViewBuilder
    func zenAccessoryBackground() -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(for: .widget) { Color.clear }
        } else {
            self
        }
    }
}
