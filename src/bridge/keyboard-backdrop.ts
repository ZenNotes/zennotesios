import { registerPlugin } from '@capacitor/core'
import { parseThemeBackdropColor, type KeyboardBackdropColor } from './keyboard-backdrop-color'

interface KeyboardBackdropPlugin {
  setColor(options: KeyboardBackdropColor): Promise<void>
}

const NativeKeyboardBackdrop = registerPlugin<KeyboardBackdropPlugin>('ZenKeyboardBackdrop')

let sentColor = ''

/** Keep the native window exposed around iOS's rounded keyboard on-theme. */
export function syncKeyboardBackdrop(): void {
  const rawColor = getComputedStyle(document.documentElement).getPropertyValue('--z-bg')
  const color = parseThemeBackdropColor(rawColor)
  if (!color) return
  const key = `${color.red} ${color.green} ${color.blue}`
  if (key === sentColor) return
  sentColor = key
  void NativeKeyboardBackdrop.setColor(color).catch(() => {
    sentColor = ''
  })
}

/**
 * The window sits behind the transparent WebView, so its color shows wherever
 * the page does not paint, and it has to follow the theme as it changes, not
 * only when a keyboard opens: index.html's pre-boot theme can be the light
 * variant of an Auto theme that core then resolves dark, and Auto follows the
 * system while the app runs. A light window under a dark theme was the whitish
 * band over the status bar in ZenNotes/zennotes#1035. Core sets the theme on
 * <html> and keeps custom themes and tweaks in <style> elements in <head>.
 */
export function watchThemeBackdrop(): void {
  let frame = 0
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0
      syncKeyboardBackdrop()
    })
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-theme-mode']
  })
  observer.observe(document.head, { childList: true, subtree: true, characterData: true })
  syncKeyboardBackdrop()
}
