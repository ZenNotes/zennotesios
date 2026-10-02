import assert from 'node:assert/strict'
import { it } from 'node:test'
import { loadMobileModule } from '../../tooling/load-mobile-module.ts'

for (const scenario of ['materialized', 'missing', 'directory', 'pending'] as const) {
  it(`handles an iCloud ${scenario} file without hashing its stale listing URI`, async () => {
    const inspected: string[] = []
    const logical = 'file:///cloud/vault/note.md'
    const stub = 'file:///cloud/vault/.note.md.icloud'
    const { NativeFs } = await loadMobileModule('./src/bridge/native-fs.ts', {
      '@capacitor/core': { Capacitor: {}, registerPlugin: () => ({
        inspect: async ({ uri }: { uri: string }) => { inspected.push(uri); return { uri } }
      }) },
      '@capacitor/filesystem': { Directory: { Documents: 'DOCUMENTS' }, Encoding: {}, Filesystem: {
        stat: async ({ path }: { path: string }) => {
          if (path === stub) return { uri: stub, type: 'file' }
          assert.equal(path, logical)
          if (scenario === 'missing') throw Object.assign(new Error('does not exist'), { code: 'OS-PLUG-FILE-0008' })
          return { uri: logical, type: scenario === 'directory' ? 'directory' : 'file' }
        }
      } },
      './icloud': { ensureDownloaded: async () => scenario === 'pending' ? 1 : 0 }
    })
    const fs = new NativeFs('vault', 'file:///cloud/vault')
    if (scenario === 'materialized') {
      await fs.readForSync('note.md', true, stub)
      assert.deepEqual(inspected, [logical])
    } else {
      await assert.rejects(fs.readForSync('note.md', true, stub))
      assert.deepEqual(inspected, [])
    }
  })
}
