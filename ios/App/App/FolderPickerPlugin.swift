import Capacitor
import UIKit
import UniformTypeIdentifiers

/// Native folder picker for the "external folder" vault tier (mobile spec
/// 03): the user picks any Files-app folder (iCloud Drive, On My iPhone,
/// Working Copy, ...) and the app keeps access across launches via a
/// security-scoped bookmark.
@objc(FolderPickerPlugin)
public class FolderPickerPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "FolderPickerPlugin"
    public let jsName = "FolderPicker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickFolder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resolveBookmark", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?

    @objc func pickFolder(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let viewController = self.bridge?.viewController else {
                call.reject("No view controller available")
                return
            }
            self.pendingCall = call
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            picker.allowsMultipleSelection = false
            picker.delegate = self
            viewController.present(picker, animated: true)
        }
    }

    public func documentPicker(
        _ controller: UIDocumentPickerViewController,
        didPickDocumentsAt urls: [URL]
    ) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        guard let url = urls.first else {
            call.resolve(["cancelled": true])
            return
        }
        // Scope must be active before creating the bookmark, and stays active
        // for the rest of this session so the vault is readable/writable.
        guard url.startAccessingSecurityScopedResource() else {
            call.reject("Could not access the selected folder.")
            return
        }
        do {
            let bookmark = try url.bookmarkData(
                options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
            call.resolve([
                "cancelled": false,
                "url": url.absoluteString,
                "name": url.lastPathComponent,
                "bookmark": bookmark.base64EncodedString()
            ])
        } catch {
            call.reject("Could not bookmark the selected folder: \(error.localizedDescription)")
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingCall?.resolve(["cancelled": true])
        pendingCall = nil
    }

    /// Re-open a bookmarked folder at boot; returns a refreshed bookmark when
    /// iOS reports the stored one is stale.
    @objc func resolveBookmark(_ call: CAPPluginCall) {
        guard let b64 = call.getString("bookmark"), let data = Data(base64Encoded: b64) else {
            call.reject("bookmark is required")
            return
        }
        do {
            var stale = false
            let url = try URL(
                resolvingBookmarkData: data, options: [],
                relativeTo: nil, bookmarkDataIsStale: &stale)
            guard url.startAccessingSecurityScopedResource() else {
                call.reject("Access to the bookmarked folder was denied.")
                return
            }
            var result: [String: Any] = [
                "url": url.absoluteString,
                "name": url.lastPathComponent
            ]
            if stale, let fresh = try? url.bookmarkData(
                options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
                result["bookmark"] = fresh.base64EncodedString()
            }
            call.resolve(result)
        } catch {
            call.reject("Could not open the bookmarked folder: \(error.localizedDescription)")
        }
    }
}
