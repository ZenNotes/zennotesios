import Capacitor
import UIKit

/// The grace period background sync runs in (src/bridge/background-sync.ts).
/// When the app leaves the screen with a sync to finish, JS calls `begin`,
/// which keeps the app running for about 30 seconds, and `end` once the sync
/// is done. If iOS ends the time first, the task is ended here (an app that
/// holds one past its expiry is killed) and JS hears `expired`, which stops
/// its Cloud requests as leaving used to.
@objc(BackgroundSyncPlugin)
public class BackgroundSyncPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BackgroundSyncPlugin"
    public let jsName = "ZenBackgroundSync"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "begin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise)
    ]

    /// Read and written on the main thread only.
    private var task: UIBackgroundTaskIdentifier = .invalid

    @objc func begin(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.task == .invalid {
                self.task = UIApplication.shared.beginBackgroundTask(withName: "ZenNotes Cloud sync") { [weak self] in
                    self?.notifyListeners("expired", data: [:])
                    self?.finish()
                }
            }
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.finish()
            call.resolve()
        }
    }

    private func finish() {
        guard task != .invalid else { return }
        UIApplication.shared.endBackgroundTask(task)
        task = .invalid
    }
}
