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
        bridge?.registerPluginInstance(CloudFilesPlugin())
        bridge?.registerPluginInstance(BackgroundSyncPlugin())
        hideScrollEdgeEffects()
    }

    /// The page draws its own chrome edge to edge and never scrolls the
    /// document (every view scrolls an inner element), so the system's scroll
    /// edge effects on the web view have nothing to mark. Apps built with the
    /// iOS 27 SDK get them whatever UIDesignRequiresCompatibility says, and
    /// the top one blurs what lies behind the transparent web view into the
    /// status bar: the window, whose color is the keyboard backdrop's, so a
    /// window still holding a light theme's color drew a whitish band over a
    /// dark theme (ZenNotes/zennotes#1035).
    private func hideScrollEdgeEffects() {
        guard #available(iOS 26.0, *), let scrollView = webView?.scrollView else { return }
        for effect in [
            scrollView.topEdgeEffect, scrollView.leftEdgeEffect,
            scrollView.bottomEdgeEffect, scrollView.rightEdgeEffect
        ] {
            effect.isHidden = true
        }
    }

    override open func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        NotificationCenter.default.post(name: Self.didAppearNotification, object: self)
    }
}
