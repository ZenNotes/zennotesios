import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { it } from 'node:test'
import { registerPlugin } from '@capacitor/core'
import { loadMobileModule } from '../../tooling/load-mobile-module.ts'

const account = {
  base_url: 'https://zennotes.org', connected_at: '2026-09-14T12:00:00Z',
  user: { name: 'Test', email: 'test@example.test' },
  device: { id: 'test-device', name: 'Test phone', platform: 'ios' }
}
const credential = JSON.stringify({ base_url: account.base_url, token: 'test-only', account })

async function coldLaunch(saved: Map<string, string>, http: Record<string, unknown> = {}) {
  const lifecycle: string[] = []
  const listeners = new Map<string, (event: any) => void>()
  let lifetime = new AbortController()
  let delayRead: { entered(): void; wait: Promise<void> } | null = null
  // Exercise the real Capacitor lazy proxy: concurrent first calls can
  // instantiate separate implementations, each with its own key prefix.
  const secureStorage = registerPlugin(`TestCloudStorage${randomUUID()}`, {
    web: async () => {
      await Promise.resolve()
      return new class {
        prefix = 'capacitor-storage_'
        async setKeyPrefix(prefix: string) { this.prefix = prefix }
        async setSynchronize(_value: boolean) {}
        async setDefaultKeychainAccess(_value: unknown) {}
        async getItem(key: string) {
          const value = saved.get(this.prefix + key) ?? null
          if (key === 'credential' && delayRead) {
            const delayed = delayRead
            delayRead = null
            delayed.entered()
            await delayed.wait
          }
          return value
        }
        async setItem(key: string, value: string) { saved.set(this.prefix + key, value) }
        async removeItem(key: string) { saved.delete(this.prefix + key) }
        async keys() {
          return [...saved.keys()].filter((key) => key.startsWith(this.prefix)).map((key) => key.slice(this.prefix.length))
        }
      }()
    }
  })
  const api = await loadMobileModule('./src/bridge/mobile-cloud-auth.ts', {
    '@capacitor/core': { Capacitor: { isNativePlatform: () => true }, CapacitorHttp: http },
    '@capacitor/app': { App: { addListener: async (name: string, listener: (event: any) => void) => {
      listeners.set(name, listener)
      return {}
    }, getLaunchUrl: async () => null } },
    '@aparajita/capacitor-secure-storage': {
      SecureStorage: secureStorage,
      KeychainAccess: { whenUnlockedThisDeviceOnly: 'device-only' }
    },
    './cloud-sync-client': {
      createCloudSyncClient: () => assert.fail('status must only read storage'),
      stopMobileCloudRequests: () => { lifecycle.push('stop'); lifetime.abort() },
      resumeMobileCloudRequests: () => { lifecycle.push('resume'); if (lifetime.signal.aborted) lifetime = new AbortController() },
      mobileCloudRequestSignal: () => lifetime.signal
    }
  })
  await api.configureMobileCloudAuth('test-version')
  api.lifecycle = lifecycle
  api.appState = (isActive: boolean) => listeners.get('appStateChange')!({ isActive })
  api.openUrl = (url: string) => listeners.get('appUrlOpen')!({ url })
  api.pauseNextCredentialRead = () => {
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const wait = new Promise<void>(resolve => { release = resolve })
    delayRead = { entered, wait }
    return { started, release }
  }
  return api
}

for (const prefix of ['zennotes.cloud.', 'capacitor-storage_']) {
  it(`loads a saved account from ${prefix} on every cold launch`, async () => {
    const saved = new Map([[prefix + 'credential', credential]])
    for (let launch = 0; launch < 2; launch++) {
      const api = await coldLaunch(saved)
      const statuses = await Promise.all([api.getMobileCloudAccountStatus(), api.getMobileCloudAccountStatus()])
      assert.deepEqual(statuses, [{ state: 'connected', account }, { state: 'connected', account }])
      assert.deepEqual([...saved.keys()], ['zennotes.cloud.credential'])
    }
  })
}

it('preserves the canonical account and prevents a legacy credential from returning after logout', async () => {
  const saved = new Map([
    ['zennotes.cloud.credential', credential],
    ['capacitor-storage_credential', JSON.stringify({ base_url: account.base_url, token: 'old-test-token', account })]
  ])
  const api = await coldLaunch(saved)
  assert.equal((await api.authenticatedCredential()).token, 'test-only')
  await api.logoutMobileCloudAccount()
  assert.ok(api.lifecycle.includes('stop'))
  assert.equal(saved.size, 0)
  assert.deepEqual(await (await coldLaunch(saved)).getMobileCloudAccountStatus(), { state: 'disconnected', account: null })
})

it('stops pending Cloud requests in the background and resumes on foreground', async () => {
  const api = await coldLaunch(new Map([['zennotes.cloud.credential', credential]]))
  api.appState(false)
  api.appState(true)
  assert.deepEqual(api.lifecycle, ['stop', 'resume'])
})

it('rejects a credential read spanning logout even after foreground creates a new lifetime', async () => {
  const saved = new Map([['zennotes.cloud.credential', credential]])
  const api = await coldLaunch(saved)
  await api.getMobileCloudAccountStatus()
  const paused = api.pauseNextCredentialRead()
  const pending = api.authenticatedClient().catch((error: unknown) => error)
  await paused.started
  await api.logoutMobileCloudAccount()
  api.appState(true)
  paused.release()
  assert.equal((await pending).name, 'AbortError')
  assert.equal(saved.size, 0)
})

it('rejects invalid recovered credentials through the shared auth validator', async () => {
  const invalid = JSON.stringify({ base_url: 'https://wrong.example.test', token: 'test-only', account })
  const saved = new Map([['capacitor-storage_credential', invalid]])
  const api = await coldLaunch(saved)
  assert.deepEqual(await api.getMobileCloudAccountStatus(), { state: 'disconnected', account: null })
  assert.equal(saved.size, 0)
})

it('recovers pending sign-in state across cold launches', async () => {
  const pending = JSON.stringify({
    base_url: account.base_url, state: 'test-state', code_verifier: 'a'.repeat(43), expires_at: '2099-01-01T00:00:00Z'
  })
  const saved = new Map([['capacitor-storage_pending-auth', pending]])
  for (let launch = 0; launch < 2; launch++) {
    const api = await coldLaunch(saved)
    assert.deepEqual(await api.getMobileCloudAccountStatus(), { state: 'connecting', account: null })
    assert.deepEqual([...saved.entries()], [['zennotes.cloud.pending-auth', pending]])
  }
})

const keyName = (email: string) => `zennotes.cloud.cloud-e2ee:https://zennotes.org#${email}`
const storedKey = (fill: number) => ({ format: 1, key: Buffer.alloc(32, fill).toString('base64'), version: 1 })

it('keeps one encryption key per account, then revokes this device and forgets every key at sign-out', async () => {
  const requests: Array<{ method: string; url: string; headers: Record<string, string> }> = []
  const saved = new Map([
    ['zennotes.cloud.credential', credential],
    [keyName('other@example.test'), JSON.stringify(storedKey(2))]
  ])
  const api = await coldLaunch(saved, {
    request: async (options: { method: string; url: string; headers: Record<string, string> }) => {
      requests.push(options)
      return { status: 401, data: {} }
    }
  })
  const store = api.mobileCloudAccountKeyStore(account)
  assert.equal(await store.load(), null)
  await store.save(storedKey(7))
  assert.deepEqual(await store.load(), storedKey(7))
  assert.equal(saved.get(keyName('test@example.test')), JSON.stringify(storedKey(7)))
  const shouting = api.mobileCloudAccountKeyStore({ ...account, user: { ...account.user, email: 'TEST@Example.test' } })
  assert.deepEqual(await shouting.load(), storedKey(7), 'an email in other letter case is the same account')
  saved.set(keyName('test@example.test'), 'not a key')
  assert.equal(await store.load(), null, 'an unreadable entry is no key')
  await store.save(storedKey(7))

  await api.logoutMobileCloudAccount()
  // 401 counts as revoked; either way sign-out finishes and no key survives it.
  assert.deepEqual(requests.map(({ method, url, headers }) => [method, url, headers.Authorization]), [
    ['DELETE', 'https://zennotes.org/api/v1/devices/current', 'Bearer test-only']
  ])
  assert.deepEqual([...saved.keys()], [])
})

it('keeps only the new account key when a different account signs in', async () => {
  const pending = JSON.stringify({
    base_url: account.base_url, state: 'test-state', code_verifier: 'a'.repeat(43), expires_at: '2099-01-01T00:00:00Z'
  })
  const saved = new Map([
    ['zennotes.cloud.credential', credential],
    ['zennotes.cloud.pending-auth', pending],
    [keyName('test@example.test'), JSON.stringify(storedKey(1))],
    [keyName('second@example.test'), JSON.stringify(storedKey(2))]
  ])
  const api = await coldLaunch(saved, {
    post: async () => ({ status: 200, data: {
      token: 'second-token', user: { name: 'Second', email: 'Second@Example.test' },
      device: { id: 'device-2', name: 'Test phone', platform: 'ios' }
    } })
  })
  const switched = new Promise((resolve) => api.onMobileCloudAccountChange(resolve))
  api.openUrl('zennotes://auth?code=abc123&state=test-state')
  assert.equal(((await switched) as { account: { user: { email: string } } }).account.user.email, 'Second@Example.test')
  assert.deepEqual([...saved.keys()].filter((key) => key.includes('cloud-e2ee')), [keyName('second@example.test')])
})
