import Capacitor
import UIKit

/// Scene-based life cycle (Info.plist `UIApplicationSceneManifest`). iOS 27
/// refuses to launch apps built with its SDK that still run the classic
/// UIApplicationDelegate-only life cycle (#26), so this is the launch path
/// now. The manifest names Main.storyboard, so UIKit builds the window and
/// its ZNViewController before `scene(_:willConnectTo:options:)`; the only
/// job left here is URL delivery, which UIKit routes to the scene instead of
/// `application(_:open:options:)` — Capacitor 7 has no scene proxy of its
/// own, so every URL is fed to `ApplicationDelegateProxy`, the same call the
/// old AppDelegate made, and `@capacitor/app` sees nothing new.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    private var pendingLaunchObserver: NSObjectProtocol?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        let urlContexts = connectionOptions.urlContexts
        let userActivities = connectionOptions.userActivities
        guard !urlContexts.isEmpty || !userActivities.isEmpty else { return }

        // Cold launch from a URL. The bridge's plugins do not exist until the
        // bridge view controller has loaded, so an `.capacitorOpenURL` posted
        // now would have no `appUrlOpen` listener. Hold the launch payload
        // until the view has appeared, as Capacitor 8.5's own scene proxy does.
        pendingLaunchObserver = NotificationCenter.default.addObserver(
            forName: ZNViewController.didAppearNotification, object: nil, queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            if let observer = self.pendingLaunchObserver {
                NotificationCenter.default.removeObserver(observer)
                self.pendingLaunchObserver = nil
            }
            self.scene(scene, openURLContexts: urlContexts)
            for activity in userActivities {
                self.scene(scene, continue: activity)
            }
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            // Widget taps (zennotes:// links) are remembered for the WebView to
            // consume at boot; see WidgetBridgePlugin.consumeLaunchLink.
            WidgetBridgePlugin.stashLaunchLink(context.url)
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared, open: context.url, options: Self.openURLOptions(context.options)
            )
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared, continue: userActivity, restorationHandler: { _ in }
        )
    }

    /// `UIScene.OpenURLOptions` in the shape `application(_:open:options:)`
    /// used to receive, so the proxy's `appUrlOpen` payload is unchanged.
    private static func openURLOptions(_ options: UIScene.OpenURLOptions) -> [UIApplication.OpenURLOptionsKey: Any] {
        var mapped: [UIApplication.OpenURLOptionsKey: Any] = [.openInPlace: options.openInPlace]
        if let sourceApplication = options.sourceApplication {
            mapped[.sourceApplication] = sourceApplication
        }
        if let annotation = options.annotation {
            mapped[.annotation] = annotation
        }
        return mapped
    }
}
