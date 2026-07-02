import UIKit
import UniformTypeIdentifiers

/// "Share to ZenNotes": grabs the shared text and/or URL, appends it to the
/// pending-captures inbox in the App Group, and dismisses immediately. The
/// main app drains the inbox into quick notes on next launch/foreground
/// (ShareInboxPlugin.swift). Share extensions cannot open their host app, so
/// deferred import is the standard pattern.
final class ShareViewController: UIViewController {
    private let appGroupId = "group.md.zennotes"
    private let pendingKey = "captures"

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        processInput()
    }

    private func processInput() {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem])?
            .flatMap { $0.attachments ?? [] } ?? []
        let group = DispatchGroup()
        let lock = NSLock()
        var texts: [String] = []
        var urls: [String] = []

        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                group.enter()
                provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
                    if let url = item as? URL {
                        lock.lock(); urls.append(url.absoluteString); lock.unlock()
                    } else if let data = item as? Data, let s = String(data: data, encoding: .utf8) {
                        lock.lock(); urls.append(s); lock.unlock()
                    }
                    group.leave()
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                group.enter()
                provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
                    if let text = item as? String {
                        lock.lock(); texts.append(text); lock.unlock()
                    } else if let data = item as? Data, let s = String(data: data, encoding: .utf8) {
                        lock.lock(); texts.append(s); lock.unlock()
                    }
                    group.leave()
                }
            }
        }

        group.notify(queue: .main) { [weak self] in
            self?.appendCapture(texts: texts, urls: urls)
            self?.extensionContext?.completeRequest(returningItems: nil)
        }
    }

    private func appendCapture(texts: [String], urls: [String]) {
        var body = texts.joined(separator: "\n\n")
        let links = urls.filter { !body.contains($0) }
        if !links.isEmpty {
            if !body.isEmpty { body += "\n\n" }
            body += links.joined(separator: "\n")
        }
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let defaults = UserDefaults(suiteName: appGroupId) else { return }

        let existing = defaults.string(forKey: pendingKey) ?? "[]"
        var captures = (try? JSONSerialization.jsonObject(with: Data(existing.utf8)))
            as? [[String: Any]] ?? []
        captures.append([
            "body": trimmed,
            "createdAt": Date().timeIntervalSince1970 * 1000
        ])
        if let data = try? JSONSerialization.data(withJSONObject: captures),
           let json = String(data: data, encoding: .utf8) {
            defaults.set(json, forKey: pendingKey)
        }
    }
}
