import UIKit
import Capacitor

/// Process-level life cycle only. Everything tied to the UI — the window,
/// URL opens, universal links, foreground/background transitions — belongs
/// to SceneDelegate: with a scene manifest in Info.plist UIKit stops calling
/// the UIApplicationDelegate counterparts, so none are implemented here.
@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        // Resolved by name against the Info.plist scene manifest, which stays
        // the single place the delegate class and storyboard are declared.
        return UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate.
    }

}
