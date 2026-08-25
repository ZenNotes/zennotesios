/**
 * The vault refresh sequence, shared between the app-foreground listener
 * (main.tsx) and the drawer's pull-to-refresh. Order matters: pull down
 * anything iCloud evicted/changed, land shared captures, then rescan so the
 * UI catches up, then let cloud sync run.
 */
import { requestCloudAutoSync } from '@zennotes/app-core/main'
import { activeVault, importPendingShares } from '../bridge/mobile-bridge'
import { ensureDownloaded, watchICloudChanges } from '../bridge/icloud'

let inFlight: Promise<void> | null = null

/**
 * Live iCloud refresh (zennotes#675): the native metadata query keeps the
 * sync daemon honest and reports inbound changes; each report becomes a
 * debounced vault refresh while an iCloud vault is open. The debounce
 * absorbs the two-step arrival of a change (spotted, then landed) so one
 * remote edit costs one rescan.
 */
export function wireICloudLiveRefresh(): void {
  let timer = 0
  watchICloudChanges(() => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      try {
        if (!activeVault().fs.isCloud) return
      } catch {
        return // no vault open yet
      }
      void refreshVault()
    }, 1500)
  })
}

/**
 * Coalesced: a refresh already in flight is returned as-is. The foreground
 * listener and pull-to-refresh can otherwise overlap (background the app
 * mid-pull, share something, foreground) and both drain the share inbox —
 * whose native read-then-remove is not atomic — importing captures twice.
 */
export function refreshVault(): Promise<void> {
  if (inFlight) return inFlight
  inFlight = doRefresh().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function doRefresh(): Promise<void> {
  try {
    const v = activeVault()
    if (v.fs.isCloud && v.fs.rootUri) await ensureDownloaded(v.fs.rootUri, 15000)
  } catch {
    // no vault open yet
  }
  await importPendingShares().catch(() => 0)
  try {
    await activeVault().rescan()
  } catch {
    // no vault open yet
  }
  // 'foreground' is an immediate-reason for the auto-sync engine — right for
  // both the app-foreground path and an explicit pull-to-refresh. Guarded so
  // a synchronous throw (auto-sync runtime not ready) can't turn every
  // foreground/pull into an unhandled rejection — the rescan already ran.
  try {
    requestCloudAutoSync('foreground')
  } catch {
    // ignore
  }
}
