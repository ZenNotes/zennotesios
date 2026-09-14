import assert from 'node:assert/strict'
import { it } from 'node:test'
import { loadMobileModule } from '../../tooling/load-mobile-module.ts'

it('allows the full publishing timeout through the native iOS transport', async () => {
  const requests: Array<{ connectTimeout?: number; readTimeout?: number }> = []
  const { createCloudSyncClient } = await loadMobileModule('./src/bridge/cloud-sync-client.ts', {
    '@capacitor/core': {
      CapacitorHttp: {
        request: async (options: { connectTimeout?: number; readTimeout?: number }) => {
          requests.push(options)
          return { status: 200, data: { id: 1, slug: 'test', url: 'https://example.test/s/test' } }
        }
      }
    }
  })
  const client = createCloudSyncClient('https://example.test', 'test-only')
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
