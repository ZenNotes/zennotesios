import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
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

it('lets a request go 30 s without a byte, gives a body its time to go out, and a publication longer', async () => {
  const options: Array<{ connectTimeout?: number; readTimeout?: number }> = []
  const { createCloudSyncClient } = await loadMobileModule('./src/bridge/cloud-sync-client.ts', {
    '@capacitor/core': {
      registerPlugin: () => ({}),
      CapacitorHttp: { request: async (request: { connectTimeout?: number; readTimeout?: number }) => {
        options.push(request)
        return { status: 200, data: { data: [], id: 1, slug: 'note', url: 'https://example.test/s/note' } }
      } }
    }
  })
  const client = createCloudSyncClient('https://example.test', 'test-only', { accountId: 'account' })
  await client.listVaults()
  await client.publishNote({ note_path: 'Note.md', title: 'Note', markdown: 'Text' })
  const text = 'x'.repeat(1024 * 1024)
  await client.mutate('vault-1', { mutations: [{
    type: 'upsert', operation_id: 'operation-1', item_id: 'item-1', base_revision: null, path: 'Big.md', kind: 'text',
    content: { encoding: 'utf8', data: text, sha256: createHash('sha256').update(text).digest('hex'), byte_length: text.length, media_type: 'text/markdown' }
  }] }).catch(() => {})
  // URLSession restarts the timeout whenever data arrives, so 30 s is how long
  // a request may wait for a byte; a big page on a slow link takes as long as
  // it needs. Bytes going out do not restart it, so a 1 MiB body also gets
  // its time at 8 KiB a second.
  assert.deepEqual(options.slice(0, 2).map(({ connectTimeout, readTimeout }) => ({ connectTimeout, readTimeout })), [
    { connectTimeout: 30_000, readTimeout: 30_000 },
    { connectTimeout: 300_000, readTimeout: 300_000 }
  ])
  const push = options[2]!
  assert.equal(push.readTimeout, push.connectTimeout)
  assert.ok(push.readTimeout! > 30_000 + 128_000 && push.readTimeout! < 30_000 + 130_000, String(push.readTimeout))
})

it('sends a read that went silent again instead of failing the sync', async (t) => {
  t.mock.method(Math, 'random', () => 0)
  const paths: string[] = []
  const { createCloudSyncClient } = await loadMobileModule('./src/bridge/cloud-sync-client.ts', {
    '@capacitor/core': {
      registerPlugin: () => ({}),
      CapacitorHttp: { request: async ({ url }: { url: string }) => {
        paths.push(new URL(url).pathname)
        if (paths.length === 1) throw Object.assign(new Error('The request timed out.'), { code: 'NSURLErrorDomain' })
        return { status: 200, data: { data: [] } }
      } }
    }
  })
  const client = createCloudSyncClient('https://example.test', 'test-only', { accountId: 'stalled-read' })
  assert.deepEqual(await client.listVaults(), { data: [] })
  assert.deepEqual(paths, ['/api/v1/vaults', '/api/v1/vaults'])
})

it('never sends a request again that the service might apply twice, and says the connection stalled', async () => {
  let calls = 0
  const { createCloudSyncClient } = await loadMobileModule('./src/bridge/cloud-sync-client.ts', {
    '@capacitor/core': {
      registerPlugin: () => ({}),
      CapacitorHttp: { request: async () => {
        calls++
        throw Object.assign(new Error('The request timed out.'), { code: 'NSURLErrorDomain' })
      } }
    }
  })
  const { describeCloudError, CLOUD_TIMEOUT_MESSAGE } = await import('@zennotes/shared-domain/cloud-error-copy')
  const client = createCloudSyncClient('https://example.test', 'test-only', { accountId: 'stalled-write' })
  const error = await client.createVault('New vault').catch((failure: unknown) => failure)
  assert.equal(calls, 1)
  assert.equal((error as Error).name, 'CloudSyncTransportError')
  assert.equal((error as { stalled?: boolean }).stalled, true)
  assert.equal(describeCloudError(error).message, CLOUD_TIMEOUT_MESSAGE)
})

it('puts an object again when the store never answered, never when it refused', async (t) => {
  t.mock.method(Math, 'random', () => 0)
  for (const outcome of ['no answer', 'refused'] as const) {
    const puts: Array<{ data?: string }> = []
    const requests: string[] = []
    const { createCloudSyncClient } = await loadMobileModule('./src/bridge/cloud-sync-client.ts', {
      '@capacitor/core': {
        registerPlugin: () => ({}),
        CapacitorHttp: { request: async (options: any) => {
          const { method, url, data } = options
          const target = new URL(url)
          if (target.host === 'objects.example.test') {
            puts.push(options)
            if (puts.length > 1) return { status: 200, data: '' }
            if (outcome === 'refused') return { status: 403, data: '' }
            throw Object.assign(new Error('The network connection was lost.'), { code: 'NSURLErrorDomain' })
          }
          requests.push(`${method} ${target.pathname}`)
          if (target.pathname.endsWith('/uploads')) {
            return { status: 201, data: { data: {
              id: 'upload-1', operation_id: data.operation_id, status: 'uploading', expected_bytes: data.content.byte_length,
              expires_at: '2099-01-01T00:00:00Z', upload: { method: 'PUT', url: 'https://objects.example.test/put', headers: {} }
            } } }
          }
          if (method === 'DELETE') return { status: 204, data: '' }
          return { status: 200, data: { data: { id: 'upload-1', operation_id: 'operation-1', status: 'completed',
            result: { acknowledged: [{ operation_id: 'operation-1', item_id: 'item-1', revision: 1, sequence: 1 }], conflicts: [], cursor: 1 } } } }
        } }
      }
    })
    const client = createCloudSyncClient('https://example.test', 'test-only', { accountId: `put-${outcome}` })
    const bytes = Buffer.alloc(5 * 1024 * 1024 + 1, 7)
    const mutation = client.mutate('vault-1', { mutations: [{
      type: 'upsert', operation_id: 'operation-1', item_id: 'item-1', base_revision: null, path: 'Scans/receipt.pdf', kind: 'binary',
      content: { encoding: 'base64', data: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex'),
        byte_length: bytes.length, media_type: 'application/pdf' }
    }] })
    if (outcome === 'no answer') {
      assert.equal((await mutation).acknowledged.length, 1)
      assert.equal(puts.length, 2)
      assert.equal(puts[1]!.data, puts[0]!.data)
      assert.deepEqual(requests, ['POST /api/v1/vaults/vault-1/uploads', 'POST /api/v1/vaults/vault-1/uploads/upload-1/complete'])
    } else {
      await assert.rejects(mutation, /403/)
      assert.equal(puts.length, 1)
      assert.deepEqual(requests, ['POST /api/v1/vaults/vault-1/uploads', 'DELETE /api/v1/vaults/vault-1/uploads/upload-1'])
    }
  }
})
