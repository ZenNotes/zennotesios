import Capacitor
import UIKit

/// App-local plugins have to be registered by hand (packaged plugins are
/// auto-discovered; in-app ones are not). Main.storyboard points its bridge
/// view controller at this subclass.
class ZNViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ShareInboxPlugin())
        bridge?.registerPluginInstance(ICloudVaultPlugin())
        bridge?.registerPluginInstance(FolderPickerPlugin())
    }
}
