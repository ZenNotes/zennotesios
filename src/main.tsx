/**
 * ZenNotes iPhone shell: install the mobile ZenBridge, open (or create) the
 * on-device vault, then mount the shared app-core UI — the same contract
 * apps/web/src/main.tsx follows, plus the mobile-only affordances layered in
 * ui-mobile/.
 *
 * Prefs/theme pre-boot lives in an inline script in index.html — it MUST run
 * before the app-core store module evaluates, and Rollup chunk hoisting makes
 * module import order unreliable for that.
 */
import { App as CapApp } from '@capacitor/app'
import { Keyboard } from '@capacitor/keyboard'
import { renderZenNotesApp } from '@zennotes/app-core/main'
import {
  installMobileBridge,
  bootVault,
  activeVault,
  importPendingShares
} from './bridge/mobile-bridge'
import { ensureDownloaded } from './bridge/icloud'
import { mountMobileShell } from './ui-mobile/MobileShell'
import './ui-mobile/mobile.css'

function wireKeyboard(): void {
  void Keyboard.addListener('keyboardWillShow', (info) => {
    document.documentElement.classList.add('zn-kb-open')
    document.documentElement.style.setProperty('--zn-kb-height', `${info.keyboardHeight}px`)
  }).catch(() => {})
  void Keyboard.addListener('keyboardWillHide', () => {
    document.documentElement.classList.remove('zn-kb-open')
    document.documentElement.style.setProperty('--zn-kb-height', '0px')
  }).catch(() => {})
}

function wireForegroundRescan(): void {
  void CapApp.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) return
    // Order matters: pull down anything iCloud evicted/changed while
    // backgrounded, land shared captures, then rescan so the UI catches up.
    void (async () => {
      try {
        const v = activeVault()
        if (v.fs.isCloud && v.fs.rootUri) await ensureDownloaded(v.fs.rootUri, 15000)
      } catch {
        // no vault open yet
      }
      await importPendingShares().catch(() => 0)
      try {
        void activeVault().rescan()
      } catch {
        // no vault open yet
      }
    })()
  }).catch(() => {})
}

async function boot(): Promise<void> {
  installMobileBridge()
  wireKeyboard()
  wireForegroundRescan()

  await bootVault()
  await importPendingShares().catch(() => 0)

  const root = document.getElementById('root')
  if (!root) throw new Error('Renderer root element #root was not found')
  renderZenNotesApp(root)
  mountMobileShell()
}

void boot().catch((err) => {
  console.error('ZenNotes failed to boot', err)
  const root = document.getElementById('root')
  if (root) {
    root.innerHTML = `<div style="padding:48px 24px;font-family:-apple-system,sans-serif;color:#ddd;background:#1d2021;height:100vh;box-sizing:border-box"><h1 style="font-size:18px">ZenNotes could not open the vault</h1><p style="font-size:14px;opacity:.8">${String(
      (err as Error)?.message ?? err
    )}</p></div>`
  }
})
