/**
 * Background sync: Settings → Cloud → Sync in the background, on by default.
 *
 * The sync engine runs in this WebView, and iOS stops running a WebView a few
 * seconds after the app leaves the screen, so a sync cannot run on a timer
 * while the app is away. What this does instead: when you leave ZenNotes, it
 * asks iOS for its grace period (`beginBackgroundTask`, about 30 seconds) and
 * finishes a sync in it, so an edit made just before leaving reaches your
 * other devices without opening the app again. Changes from those devices
 * still arrive when the app comes back.
 *
 * Leaving used to stop every Cloud request at once (cloud-sync-client.ts
 * binds them to one lifetime), which abandoned a sync in progress. With the
 * setting on, the requests stop after that final sync instead, or when iOS
 * ends the grace period; with it off, or before this module is installed,
 * leaving stops them at once, as before. Signing out stops them at once
 * either way.
 */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { VaultChangeEvent } from '@zennotes/bridge-contract/ipc'
import { BACKGROUND_SYNC_KEY } from '../viewport'
import { resumeMobileCloudRequests, stopMobileCloudRequests } from './cloud-sync-client'

export { BACKGROUND_SYNC_KEY }

/** The editor writes a note 350 ms after the last keystroke (app-core's
 *  PATH_SAVE_DEBOUNCE_MS). Waiting a little longer lets an edit made just
 *  before leaving reach the disk before the sync reads the vault. */
const SAVE_SETTLE_MS = 500

/** A second pass runs only when the vault changed during the first. Never
 *  more: the sync's own rescan reports changes too. */
const MAX_PASSES = 2

export interface BackgroundSyncPlugin {
  /** Starts the grace period (UIApplication.beginBackgroundTask). */
  begin(): Promise<void>
  end(): Promise<void>
  /** iOS is ending the grace period; the native side has ended the task. */
  addListener(event: 'expired', listener: () => void): Promise<PluginListenerHandle>
}

/** What this module needs from the open vault (mobile-bridge.ts). */
export interface BackgroundSyncHost {
  /** Signed in, and the open vault is linked to this account's Cloud. */
  ready(): Promise<boolean>
  /** One sync pass of the open vault; joins a pass that is already running. */
  sync(): Promise<void>
  onVaultChange(listener: (event: VaultChangeEvent) => void): () => void
}

let host: BackgroundSyncHost | null = null
let plugin: BackgroundSyncPlugin | null = null
let active = true
let leaving: Promise<void> | null = null
let runs = 0

/** Registered on first use, so loading this module never touches native code. */
function native(): BackgroundSyncPlugin {
  plugin ??= registerPlugin<BackgroundSyncPlugin>('ZenBackgroundSync')
  return plugin
}

export function backgroundSyncEnabled(): boolean {
  try {
    return localStorage.getItem(BACKGROUND_SYNC_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setBackgroundSyncEnabled(enabled: boolean): void {
  try {
    // On is the default, so it removes the key: a fresh install and a reset
    // look the same.
    if (enabled) localStorage.removeItem(BACKGROUND_SYNC_KEY)
    else localStorage.setItem(BACKGROUND_SYNC_KEY, 'off')
  } catch {
    // Storage unavailable: the choice applies to this session only.
  }
}

export function installBackgroundSync(next: BackgroundSyncHost): void {
  if (host) return
  host = next
  void native()
    .addListener('expired', () => {
      // The grace period is over: stop as leaving used to, unless the app is
      // already back on screen.
      if (!active) stopMobileCloudRequests()
    })
    .catch(() => {})
}

/** The app left the screen (Capacitor's appStateChange, isActive false). */
export function leaveApp(): void {
  active = false
  const current = host
  if (!current || !backgroundSyncEnabled()) {
    stopMobileCloudRequests()
    return
  }
  leaving ??= holdRequests(() => finishSync(current)).finally(() => {
    leaving = null
  })
}

/** The app is back on screen. */
export function returnToApp(): void {
  active = true
  resumeMobileCloudRequests()
}

/** Settles once the final sync started by leaving has ended (tests). */
export function backgroundSyncSettled(): Promise<void> {
  return leaving ?? Promise.resolve()
}

/** Background work keeps Cloud requests open; the last run to end stops them
 *  if the app is still away. */
async function holdRequests(work: () => Promise<void>): Promise<void> {
  runs += 1
  try {
    await work()
  } finally {
    runs -= 1
    if (runs === 0 && !active) stopMobileCloudRequests()
  }
}

async function finishSync(current: BackgroundSyncHost): Promise<void> {
  let began = false
  try {
    if (!(await current.ready())) return
    await native().begin()
    began = true
    await delay(SAVE_SETTLE_MS)
    await syncPasses(current)
  } catch (error) {
    // The next foreground sync picks it up; nothing here can be shown.
    console.warn('Background sync did not finish', error)
  } finally {
    if (began) await native().end().catch(() => {})
  }
}

async function syncPasses(current: BackgroundSyncHost): Promise<void> {
  let changed = false
  const stopWatching = current.onVaultChange(() => {
    changed = true
  })
  try {
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      changed = false
      await current.sync()
      if (!changed) break
    }
  } finally {
    stopWatching()
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
