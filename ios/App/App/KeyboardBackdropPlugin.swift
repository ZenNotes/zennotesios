import Capacitor
import UIKit

/// Backport of Capacitor Keyboard 8's theme-aware iOS backdrop behavior.
/// Native keyboard resize shortens the WKWebView, so the UIWindow is visible
/// around the rounded system keyboard and in the app-switcher snapshot.
@objc(KeyboardBackdropPlugin)
public class KeyboardBackdropPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KeyboardBackdropPlugin"
    public let jsName = "ZenKeyboardBackdrop"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setColor", returnType: CAPPluginReturnPromise)
    ]

    @objc func setColor(_ call: CAPPluginCall) {
        guard
            let red = call.getInt("red"),
            let green = call.getInt("green"),
            let blue = call.getInt("blue"),
            (0...255).contains(red),
            (0...255).contains(green),
            (0...255).contains(blue)
        else {
            call.reject("red, green, and blue must be integers from 0 through 255")
            return
        }

        DispatchQueue.main.async {
            guard let window = self.bridge?.viewController?.view.window else {
                call.reject("No app window available")
                return
            }
            window.backgroundColor = UIColor(
                red: CGFloat(red) / 255,
                green: CGFloat(green) / 255,
                blue: CGFloat(blue) / 255,
                alpha: 1
            )
            call.resolve()
        }
    }
}
