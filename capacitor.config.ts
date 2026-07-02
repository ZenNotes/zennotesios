import type { CapacitorConfig } from '@capacitor/cli'
import { KeyboardResize } from '@capacitor/keyboard'

const config: CapacitorConfig = {
  appId: 'md.zennotes',
  appName: 'ZenNotes',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
    backgroundColor: '#00000000'
  },
  plugins: {
    Keyboard: {
      resize: KeyboardResize.Native,
      resizeOnFullScreen: true
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 400,
      backgroundColor: '#1d2021'
    }
  }
}

export default config
