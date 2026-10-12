import assert from 'node:assert/strict'
import { it } from 'node:test'
import { generateCloudE2eeKey, toBase64 } from '@zennotes/shared-domain/cloud-e2ee'
import { CloudE2eeKeyring } from '@zennotes/shared-domain/cloud-e2ee-account'
import { CloudVaultCipher } from '@zennotes/shared-domain/cloud-e2ee-vault'
import { loadMobileModule } from '../../tooling/load-mobile-module.ts'

it('allows the full publishing timeout through the native iOS transport', async () => {
  const requests: Array<{ connectTimeout?: number; readTimeout?: number }> = []
  const { createCloudSyncClient } = await loadMobileModule('./src/bridge/cloud-sync-client.ts', {
    '@capacitor/core': {
      registerPlugin: () => ({}),
      CapacitorHttp: {
        request: async (options: { connectTimeout?: number; readTimeout?: number }) => {
          requests.push(options)
          return { status: 200, data: { id: 1, slug: 'test', url: 'https://example.test/s/test' } }
        }
      }
    }
  })
  const client = createCloudSyncClient('https://example.test', 'test-only', { accountId: 'account' })
  const note = { note_path: 'Test.md', title: 'Test', markdown: 'Latest content' }
  await client.publishNote(note)
  await client.updatePublishedNote(1, note)
  // Capacitor 7 iOS applies connectTimeout ?? readTimeout to the entire
  // URLRequest, so a shorter connection value silently wins over readTimeout.
  assert.deepEqual(requests.map(({ connectTimeout, readTimeout }) => ({ connectTimeout, readTimeout })), [
    { connectTimeout: 300_000, readTimeout: 300_000 },
    { connectTimeout: 300_000, readTimeout: 300_000 }
  ])
})

it('marks every request once this host opens encrypted vaults, and lists their real names only while unlocked', async () => {
  const accountKey = generateCloudE2eeKey()
  const vaults = [
    { id: 'vault-1', name: 'Readable', cursor: 0, created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:00:00Z', encryption: null },
    // The service stores a placeholder; a locked device never shows whatever it sends.
    { id: 'vault-2', name: 'Name from the service', cursor: 0, created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:00:00Z',
      encryption: await CloudVaultCipher.prepareVault('Private notes', accountKey, 1) }
  ]
  const headers: Array<Record<string, string>> = []
  const { createCloudSyncClient } = await loadMobileModule('./src/bridge/cloud-sync-client.ts', {
    '@capacitor/core': {
      registerPlugin: () => ({}),
      CapacitorHttp: {
        request: async (options: { headers: Record<string, string> }) => {
          headers.push(options.headers)
          return { status: 200, data: { data: vaults } }
        }
      }
    }
  })
  const keyring = (unlocked: boolean) => new CloudE2eeKeyring({
    listVaults: async () => vaults,
    store: { load: async () => unlocked ? { format: 1, key: toBase64(accountKey), version: 1 } : null, save: async () => {}, clear: async () => {} }
  })
  const names = async (options: Record<string, unknown>) =>
    (await createCloudSyncClient('https://example.test', 'test-only', { accountId: 'account', ...options }).listVaults()).data
      .map((vault: { name: string }) => vault.name)

  assert.deepEqual(await names({ keyring: keyring(true) }), ['Readable', 'Private notes'])
  assert.deepEqual(await names({ keyring: keyring(false) }), ['Readable', 'Encrypted vault'])
  assert.deepEqual(await names({}), ['Readable', 'Name from the service'])
  assert.deepEqual(headers.map((sent) => [sent['X-ZenNotes-Encryption'], sent.Authorization]), [
    ['zne1', 'Bearer test-only'], ['zne1', 'Bearer test-only'], [undefined, 'Bearer test-only']
  ])
})
