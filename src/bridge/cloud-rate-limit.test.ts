import assert from 'node:assert/strict'
import { it } from 'node:test'
import { loadMobileModule } from '../../tooling/load-mobile-module.ts'

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

it('retries the same native manifest page after the complete Retry-After delay', async (test) => {
  const requests: string[] = []
  const { createCloudSyncClient } = await loadMobileModule('./src/bridge/cloud-sync-client', {
    '@capacitor/core': { registerPlugin: () => ({}), CapacitorHttp: { request: async ({ url }: { url: string }) => {
      requests.push(url)
      return requests.length === 1
        ? { status: 429, data: '<html>Slow down</html>', headers: { 'rEtRy-AfTeR': '2' } }
        : { status: 200, data: { data: [], cursor: 500, next_page: null } }
    } } }
  })
  test.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 })
  const client = createCloudSyncClient('https://retry.example.test', 'test-token', { accountId: 'account' })
  let settled = false
  const pending = client.manifest('vault', { includeContent: false, page: 3, perPage: 250 })
    .then((data: unknown) => ({ data }), (error: unknown) => ({ error })).finally(() => { settled = true })
  await flush()
  assert.equal(settled, false)
  test.mock.timers.tick(1999)
  await flush()
  assert.equal(requests.length, 1)
  test.mock.timers.tick(1)
  assert.deepEqual(await pending, { data: { data: [], cursor: 500, next_page: null } })
  assert.equal(requests.length, 2)
  assert.equal(requests[0], requests[1])
})

it('cancels a native retry wait and preserves its cooldown across recreated clients', async (test) => {
  const requests: string[] = []
  const api = await loadMobileModule('./src/bridge/cloud-sync-client', {
    '@capacitor/core': { registerPlugin: () => ({}), CapacitorHttp: { request: async ({ url }: { url: string }) => {
      requests.push(url)
      return requests.length === 1
        ? { status: 429, data: {}, headers: { 'Retry-After': '2' } }
        : { status: 200, data: { data: [] } }
    } } }
  })
  test.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 })
  const first = api.createCloudSyncClient('https://cancel.example.test', 'old-token', { accountId: 'account' })
    .listVaults().catch((error: unknown) => error)
  await flush()
  api.stopMobileCloudRequests()
  assert.equal((await first).name, 'AbortError')
  api.resumeMobileCloudRequests()
  const pending = api.createCloudSyncClient('https://cancel.example.test', 'new-token', { accountId: 'account' }).listVaults()
  await flush()
  assert.equal(requests.length, 1)
  test.mock.timers.tick(2000)
  assert.deepEqual(await pending, { data: [] })
  assert.equal(requests.length, 2)
})
