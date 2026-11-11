import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadMobileModule } from '../../tooling/load-mobile-module.ts'

// @zennotes/portable-vault's VaultFileSystem contract over this app's
// NativeFs, on an in-memory Capacitor Filesystem that answers with the iOS
// plugin's own codes: OS-PLUG-FILE-0008 for a path that does not exist and
// OS-PLUG-FILE-0013 for an operation that failed. The device fixture
// (tooling/native-boundary-fixture.ts) runs the same cases on the real file
// system, where an outage cannot be produced (Capacitor reports a path it
// cannot reach as not found); here an outage is a failing store, and NativeFs
// must report it as a failure, never as an empty folder or a missing file.

type Entry = { kind: 'file'; bytes: Uint8Array; mtime: number } | { kind: 'dir'; mtime: number }

class CapacitorFilesystem {
  entries = new Map<string, Entry>([['', { kind: 'dir', mtime: 1 }]])
  outage = false
  clock = 1_000

  private fail(path: string, notFound: boolean): never {
    if (notFound) throw Object.assign(new Error(`'op' failed because file at '${path}' does not exist.`), { code: 'OS-PLUG-FILE-0008' })
    throw Object.assign(new Error('The operation failed.'), { code: 'OS-PLUG-FILE-0013' })
  }
  private key(o: { path: string }): string {
    if (this.outage) this.fail(o.path, false)
    return o.path.replace(/^\/+|\/+$/g, '')
  }
  private parent(key: string): string {
    return key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : ''
  }
  private makeParents(key: string): void {
    let dir = this.parent(key)
    const missing: string[] = []
    while (dir && !this.entries.has(dir)) { missing.push(dir); dir = this.parent(dir) }
    for (const name of missing) this.entries.set(name, { kind: 'dir', mtime: (this.clock += 1) })
  }
  async mkdir(o: { path: string; recursive?: boolean }) {
    const key = this.key(o)
    if (this.entries.has(key)) throw new Error('Directory already exists')
    this.makeParents(`${key}/x`)
  }
  async getUri(o: { path: string }) {
    return { uri: `file:///Documents/${this.key(o)}` }
  }
  async readFile(o: { path: string; encoding?: string }) {
    const key = this.key(o)
    const entry = this.entries.get(key)
    if (!entry) this.fail(o.path, true)
    if (entry.kind !== 'file') this.fail(o.path, false)
    return { data: o.encoding ? new TextDecoder().decode(entry.bytes) : Buffer.from(entry.bytes).toString('base64') }
  }
  async writeFile(o: { path: string; data: string; encoding?: string; recursive?: boolean }) {
    const key = this.key(o)
    if (o.recursive) this.makeParents(key)
    else if (!this.entries.has(this.parent(key))) this.fail(o.path, false)
    const bytes = o.encoding ? new TextEncoder().encode(o.data) : Uint8Array.from(Buffer.from(o.data, 'base64'))
    this.entries.set(key, { kind: 'file', bytes, mtime: (this.clock += 1) })
    return { uri: `file:///Documents/${key}` }
  }
  async stat(o: { path: string }) {
    const key = this.key(o)
    const entry = this.entries.get(key)
    if (!entry) this.fail(o.path, true)
    return { type: entry.kind === 'dir' ? 'directory' : 'file', size: entry.kind === 'file' ? entry.bytes.length : 0, mtime: entry.mtime, ctime: entry.mtime, uri: `file:///Documents/${key}` }
  }
  async readdir(o: { path: string }) {
    const key = this.key(o)
    const entry = this.entries.get(key)
    if (!entry) this.fail(o.path, true)
    if (entry.kind !== 'dir') this.fail(o.path, false)
    const prefix = key ? `${key}/` : ''
    const files = [...this.entries].filter(([path]) => path !== key && path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map(([path, child]) => ({ name: path.slice(prefix.length), type: child.kind === 'dir' ? 'directory' : 'file', size: child.kind === 'file' ? child.bytes.length : 0, mtime: child.mtime, uri: `file:///Documents/${path}` }))
    return { files }
  }
  private move(from: string, to: string, keep: boolean): void {
    if (!this.entries.has(from)) this.fail(from, true)
    this.makeParents(to)
    for (const [path, entry] of [...this.entries]) {
      if (path !== from && !path.startsWith(`${from}/`)) continue
      this.entries.set(to + path.slice(from.length), entry.kind === 'file' ? { ...entry, bytes: entry.bytes.slice(), mtime: (this.clock += 1) } : entry)
      if (!keep) this.entries.delete(path)
    }
  }
  async rename(o: { from: string; to: string }) { this.move(this.key({ path: o.from }), this.key({ path: o.to }), false) }
  async copy(o: { from: string; to: string }) { this.move(this.key({ path: o.from }), this.key({ path: o.to }), true) }
  async deleteFile(o: { path: string }) {
    const key = this.key(o)
    if (this.entries.get(key)?.kind !== 'file') this.fail(o.path, true)
    this.entries.delete(key)
  }
  async rmdir(o: { path: string; recursive?: boolean }) {
    const key = this.key(o)
    if (this.entries.get(key)?.kind !== 'dir') this.fail(o.path, true)
    const inside = [...this.entries.keys()].filter((path) => path.startsWith(`${key}/`))
    if (inside.length > 0 && !o.recursive) throw Object.assign(new Error('Folder is not empty.'), { code: 'OS-PLUG-FILE-0012' })
    for (const path of [key, ...inside]) this.entries.delete(path)
  }
}

const disk = new CapacitorFilesystem()
const { NativeFs, vaultFileSystemContract } = await loadMobileModule(
  ['./src/bridge/native-fs.ts', '@zennotes/portable-vault/vault-fs-contract'],
  {
    '@capacitor/filesystem': { Directory: { Documents: 'DOCUMENTS', Data: 'DATA' }, Encoding: { UTF8: 'utf8' }, Filesystem: disk },
    '@capacitor/core': { Capacitor: { convertFileSrc: (uri: string) => uri }, registerPlugin: () => ({}) },
    './icloud': { ensureDownloaded: async () => 0 }
  }
)

let vaults = 0
const harness = {
  async create() {
    const fs = new NativeFs(`Contract ${(vaults += 1)}`)
    await fs.init()
    return fs
  },
  async reopen(fs: { rootPath: string }) {
    const again = new NativeFs(fs.rootPath.slice('ZenNotes/'.length))
    await again.init()
    return again
  },
  breakStorage: () => { disk.outage = true },
  restoreStorage: () => { disk.outage = false }
}

for (const contract of vaultFileSystemContract as Array<{ name: string; run(h: typeof harness): Promise<void> }>) {
  test(`NativeFs keeps the VaultFileSystem contract: ${contract.name}`, () => contract.run(harness))
}

test('NativeFs keys the Cloud link on ZenNotes/<name> on every tier, never the container URI', () => {
  assert.equal(new NativeFs('My Vault').syncKey, 'ZenNotes/My Vault')
  assert.equal(new NativeFs('My Vault', 'file:///private/var/mobile/Library/Mobile%20Documents/iCloud~md~zennotes/Documents/My%20Vault').syncKey, 'ZenNotes/My Vault')
})
