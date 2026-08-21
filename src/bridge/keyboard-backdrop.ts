import { registerPlugin } from '@capacitor/core'
import { parseThemeBackdropColor, type KeyboardBackdropColor } from './keyboard-backdrop-color'

interface KeyboardBackdropPlugin {
  setColor(options: KeyboardBackdropColor): Promise<void>
}

const NativeKeyboardBackdrop = registerPlugin<KeyboardBackdropPlugin>('ZenKeyboardBackdrop')

/** Keep the native window exposed around iOS's rounded keyboard on-theme. */
export function syncKeyboardBackdrop(): void {
  const rawColor = getComputedStyle(document.documentElement).getPropertyValue('--z-bg')
  const color = parseThemeBackdropColor(rawColor)
  if (!color) return
  void NativeKeyboardBackdrop.setColor(color).catch(() => {})
}
