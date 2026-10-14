import assert from 'node:assert/strict'
import { it } from 'node:test'
import { loadMobileModule } from '../../tooling/load-mobile-module.ts'

const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key)
}

interface Harness {
  api: Record<string, any>
  calls: string[]
  vaultListeners: Set<() => void>
  /** Fires the native `expired` event, as the plugin does when iOS ends the time. */
  expire(): void
  /** Emits a vault change, as an in-app write or the sync's rescan does. */
  change(): void
}

async function load(): Promise<Harness> {
  const calls: string[] = []
  const listeners = new Map<string, () => void>()
  const vaultListeners = new Set<() => void>()
  const plugin = {
    begin: async () => void calls.push('begin'),
    end: async () => void calls.push('end'),
    addListener: async (event: string, listener: () => void) => {
      listeners.set(event, listener)
      return { remove: async () => {} }
    }
  }
  const api = await loadMobileModule('./src/bridge/background-sync.ts', {
    '@capacitor/core': { registerPlugin: () => plugin },
    './cloud-sync-client': {
      stopMobileCloudRequests: () => void calls.push('stop'),
      resumeMobileCloudRequests: () => void calls.push('resume')
    }
  })
  return {
    api,
    calls,
    vaultListeners,
    expire: () => listeners.get('expired')?.(),
    change: () => {
      for (const listener of vaultListeners) listener()
    }
  }
}

function host(harness: Harness, options: { ready?: boolean; sync?: () => Promise<void> } = {}) {
  const listeners = harness.vaultListeners
  return {
    ready: async () => {
      harness.calls.push('ready')
      return options.ready ?? true
    },
    sync: options.sync ?? (async () => void harness.calls.push('sync')),
    onVaultChange: (listener: () => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}

it('is on by default, and turning it on again removes the stored choice', async () => {
  store.clear()
  const { api } = await load()
  assert.equal(api.backgroundSyncEnabled(), true)
  api.setBackgroundSyncEnabled(false)
  assert.equal(store.get(api.BACKGROUND_SYNC_KEY), 'off')
  assert.equal(api.backgroundSyncEnabled(), false)
  api.setBackgroundSyncEnabled(true)
  assert.equal(store.has(api.BACKGROUND_SYNC_KEY), false)
  assert.equal(api.backgroundSyncEnabled(), true)
})

it('stops Cloud requests at once on leaving before it is installed, as leaving always did', async () => {
  store.clear()
  const harness = await load()
  harness.api.leaveApp()
  harness.api.returnToApp()
  assert.deepEqual(harness.calls, ['stop', 'resume'])
})

it('stops at once when the setting is off, without asking whether the vault is ready', async () => {
  store.clear()
  store.set('zn:background-sync', 'off')
  const harness = await load()
  harness.api.installBackgroundSync(host(harness))
  harness.api.leaveApp()
  await harness.api.backgroundSyncSettled()
  assert.deepEqual(harness.calls, ['stop'])
})

it('finishes a sync in the grace period, then stops requests', async () => {
  store.clear()
  const harness = await load()
  harness.api.installBackgroundSync(host(harness))
  harness.api.leaveApp()
  assert.equal(harness.calls.includes('stop'), false, 'requests keep running while the final sync is pending')
  await harness.api.backgroundSyncSettled()
  assert.deepEqual(harness.calls, ['ready', 'begin', 'sync', 'end', 'stop'])
})

it('stops without a grace period when the vault is not linked to Cloud', async () => {
  store.clear()
  const harness = await load()
  harness.api.installBackgroundSync(host(harness, { ready: false }))
  harness.api.leaveApp()
  await harness.api.backgroundSyncSettled()
  assert.deepEqual(harness.calls, ['ready', 'stop'])
})

it('keeps requests running when the app comes back before the final sync ends', async () => {
  store.clear()
  const harness = await load()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  harness.api.installBackgroundSync(host(harness, {
    sync: async () => {
      harness.calls.push('sync')
      await gate
    }
  }))
  harness.api.leaveApp()
  while (!harness.calls.includes('sync')) await new Promise((resolve) => setTimeout(resolve, 10))
  harness.api.returnToApp()
  release()
  await harness.api.backgroundSyncSettled()
  assert.deepEqual(harness.calls, ['ready', 'begin', 'sync', 'resume', 'end'])
})

it('runs a second pass when the vault changed during the first, and never a third', async () => {
  store.clear()
  const harness = await load()
  let passes = 0
  harness.api.installBackgroundSync(host(harness, {
    sync: async () => {
      passes += 1
      harness.calls.push('sync')
      // Every pass reports a change, as a sync that pulled notes does.
      harness.change()
    }
  }))
  harness.api.leaveApp()
  await harness.api.backgroundSyncSettled()
  assert.equal(passes, 2)
  assert.deepEqual(harness.calls, ['ready', 'begin', 'sync', 'sync', 'end', 'stop'])
})

it('includes an edit saved while it waits for the editor', async () => {
  store.clear()
  const harness = await load()
  let passes = 0
  harness.api.installBackgroundSync(host(harness, {
    sync: async () => {
      passes += 1
      harness.calls.push('sync')
    }
  }))
  harness.api.leaveApp()
  // The editor's save lands during the wait, before the first pass.
  while (!harness.calls.includes('begin')) await new Promise((resolve) => setTimeout(resolve, 5))
  harness.change()
  await harness.api.backgroundSyncSettled()
  assert.equal(passes, 1, 'one pass reads the saved edit; the change came before it')
})

it('stops requests when iOS ends the grace period first, and still ends the task', async () => {
  store.clear()
  const harness = await load()
  harness.api.installBackgroundSync(host(harness, {
    sync: async () => {
      harness.calls.push('sync')
      harness.expire()
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
  }))
  harness.api.leaveApp()
  await harness.api.backgroundSyncSettled()
  assert.deepEqual(harness.calls, ['ready', 'begin', 'sync', 'stop', 'end', 'stop'])
})

it('ignores an expiry that arrives after the app is back on screen', async () => {
  store.clear()
  const harness = await load()
  harness.api.installBackgroundSync(host(harness))
  harness.api.returnToApp()
  harness.expire()
  assert.deepEqual(harness.calls, ['resume'])
})

it('starts one final sync however often the app leaves while it runs', async () => {
  store.clear()
  const harness = await load()
  let passes = 0
  harness.api.installBackgroundSync(host(harness, {
    sync: async () => {
      passes += 1
      harness.calls.push('sync')
    }
  }))
  harness.api.leaveApp()
  harness.api.leaveApp()
  await harness.api.backgroundSyncSettled()
  assert.equal(passes, 1)
})
