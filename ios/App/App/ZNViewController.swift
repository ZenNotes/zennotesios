import Capacitor
import UIKit

/// App-local plugins have to be registered by hand (packaged plugins are
/// auto-discovered; in-app ones are not). Main.storyboard points its bridge
/// view controller at this subclass; the scene manifest names that
/// storyboard, so UIKit instantiates it as the scene's root.
class ZNViewController: CAPBridgeViewController {
    /// Posted from `viewDidAppear`, i.e. once the bridge and every plugin
    /// exist. SceneDelegate holds cold-launch URLs until the first one.
    static let didAppearNotification = Notification.Name("ZNViewControllerDidAppear")

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ShareInboxPlugin())
        bridge?.registerPluginInstance(ICloudVaultPlugin())
        bridge?.registerPluginInstance(FolderPickerPlugin())
        bridge?.registerPluginInstance(KeyboardBackdropPlugin())
        bridge?.registerPluginInstance(WidgetBridgePlugin())
    }

    override open func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        NotificationCenter.default.post(name: Self.didAppearNotification, object: self)
    }
}
