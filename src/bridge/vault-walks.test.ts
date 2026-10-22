import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadMobileModule } from '../../tooling/load-mobile-module.ts'

// app-core asks for notes and folders together on every refresh, with two
// refreshes at once when a note is created or the app comes back, so one New
// note listed the tree four times over. On Android, where a picked folder
// answers every listing with a document-provider query, that took 12 to 15
// seconds on a budget phone (zennotesandroid#128), and these walks are the
// same code. Overlapping walks now share their listings, a write the vault
// makes never lets a listing taken before it be reused, and the task scan
// reads only notes whose listing changed.

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } })
const { MobileVault } = await loadMobileModule(['./src/bridge/vault-fs'])

interface MemoryFile { body: string; mtime: number }

/** The NativeFs surface the walks use, counting listings and reads. Writes
 *  move the write generation the way NativeFs does. */
class MemoryFs {
  files = new Map<string, MemoryFile>()
  listings = new Map<string, number>()
  reads = new Map<string, number>()
  writeGeneration = 0
  clock = 1_000

  put(path: string, body: string): void {
    this.files.set(path, { body, mtime: (this.clock += 1) })
  }
  private isDirectory(path: string): boolean {
    return path === '' || [...this.files.keys()].some((key) => key.startsWith(`${path}/`))
  }
  async readdir(path: string) {
    this.listings.set(path, (this.listings.get(path) ?? 0) + 1)
    const prefix = path ? `${path}/` : ''
    const entries = new Map<string, { name: string; type: 'file' | 'directory'; size: number; mtime: number }>()
    for (const [key, file] of this.files) {
      if (!key.startsWith(prefix)) continue
      const [name, ...nested] = key.slice(prefix.length).split('/')
      entries.set(name!, nested.length
        ? { name: name!, type: 'directory', size: 0, mtime: 0 }
        : { name: name!, type: 'file', size: file.body.length, mtime: file.mtime })
    }
    return [...entries.values()]
  }
  async statOrNull(path: string) {
    const file = this.files.get(path)
    if (file) return { type: 'file', size: file.body.length, mtime: file.mtime, ctime: null, uri: path }
    return this.isDirectory(path) ? { type: 'directory', size: 0, mtime: 0, ctime: null, uri: path } : null
  }
  async readTextOrNull(path: string) {
    this.reads.set(path, (this.reads.get(path) ?? 0) + 1)
    return this.files.get(path)?.body ?? null
  }
  async writeText(path: string, body: string) {
    this.writeGeneration += 1
    this.put(path, body)
    this.writeGeneration += 1
  }
  listingsOf(path: string): number {
    return this.listings.get(path) ?? 0
  }
  totalReads(): number {
    // Notes only: vault.json and the meta cache are read on their own terms.
    return [...this.reads.entries()].filter(([path]) => path.endsWith('.md')).reduce((n, [, count]) => n + count, 0)
  }
}

function fixture() {
  const fs = new MemoryFs()
  fs.put('.zennotes/vault.json', JSON.stringify({ primaryNotesLocation: 'inbox' }))
  fs.put('inbox/Plan.md', '# Plan\n\n- [ ] write the plan\n')
  fs.put('inbox/Projects/Site.md', '# Site\n\n- [ ] ship the site\n')
  fs.put('inbox/Projects/Notes.md', '# Notes\n\nno tasks here\n')
  fs.put('quick/Quick Note.md', '# Quick Note\n\n- [ ] call back\n')
  fs.put('archive/Old.md', '# Old\n\n- [x] done long ago\n')
  fs.put('trash/Gone.md', '# Gone\n\n- [ ] in the trash\n')
  fs.put('attachements/photo.png', 'png')
  const vault = new MobileVault('Fixture')
  Object.assign(vault, { fs })
  return { fs, vault }
}

const paths = (notes: { path: string }[]): string[] => notes.map((note) => note.path).sort()

test('a refresh lists each folder once while notes, folders and assets are walked together', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { fs, vault } = fixture()
  const [notes, folders, assets] = await Promise.all([
    vault.listNotes(), vault.listFolders(), vault.listAssets(),
    // The second refresh a new note starts, overlapping the first.
    vault.listNotes(), vault.listFolders()
  ])
  assert.deepEqual(paths(notes), [
    'archive/Old.md', 'inbox/Plan.md', 'inbox/Projects/Notes.md', 'inbox/Projects/Site.md',
    'quick/Quick Note.md', 'trash/Gone.md'
  ])
  assert.deepEqual(folders.map((f: { subpath: string }) => f.subpath), ['Projects'])
  assert.deepEqual(assets.map((a: { path: string }) => a.path), ['attachements/photo.png'])
  for (const dir of ['inbox', 'inbox/Projects', 'quick', 'archive', 'trash']) {
    assert.equal(fs.listingsOf(dir), 1, `${dir} listed once`)
  }
})

test('a write the vault makes is never hidden by a listing taken before it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { fs, vault } = fixture()
  await vault.listNotes()
  await vault.writeNote('inbox/Fresh.md', '# Fresh\n')
  // Within the grace window, right after the write: the note is listed.
  assert.ok(paths(await vault.listNotes()).includes('inbox/Fresh.md'))
  assert.equal(fs.listingsOf('inbox/Projects'), 2)
})

test('a walk after the grace window lists afresh, so a rescan sees outside changes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { fs, vault } = fixture()
  await vault.listNotes()
  // Syncthing drops a note in; the vault made no write.
  fs.put('inbox/From Desktop.md', '# From Desktop\n')
  assert.equal(paths(await vault.listNotes()).includes('inbox/From Desktop.md'), false)
  t.mock.timers.tick(1000)
  assert.equal(paths(await vault.listNotes()).includes('inbox/From Desktop.md'), true)
})

test('the task scan reads a note again only when its listing changed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { fs, vault } = fixture()
  const titles = async (): Promise<string[]> =>
    (await vault.scanTasks()).map((task: { content: string }) => task.content).sort()

  assert.deepEqual(await titles(), ['call back', 'done long ago', 'ship the site', 'write the plan'])
  const firstReads = fs.totalReads()

  t.mock.timers.tick(1000)
  assert.deepEqual(await titles(), ['call back', 'done long ago', 'ship the site', 'write the plan'])
  assert.equal(fs.totalReads(), firstReads, 'an unchanged vault is not read again')

  // Edited elsewhere: new mtime and size in the listing.
  fs.put('inbox/Projects/Site.md', '# Site\n\n- [ ] ship it today\n')
  const readsBefore = new Map(fs.reads)
  t.mock.timers.tick(1000)
  assert.deepEqual(await titles(), ['call back', 'done long ago', 'ship it today', 'write the plan'])
  const readAgain = [...fs.reads].filter(([path, n]) => path.endsWith('.md') && n !== readsBefore.get(path))
  assert.deepEqual(readAgain.map(([path]) => path), ['inbox/Projects/Site.md'])
})

test('a note the app writes is read again by the next task scan', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { fs, vault } = fixture()
  await vault.scanTasks()
  const before = fs.reads.get('inbox/Plan.md') ?? 0
  await vault.writeNote('inbox/Plan.md', '# Plan\n\n- [x] write the plan\n')
  const plan = (await vault.scanTasks()).filter((task: { sourcePath: string }) => task.sourcePath === 'inbox/Plan.md')
  assert.deepEqual(plan.map((task: { checked: boolean }) => task.checked), [true])
  assert.equal((fs.reads.get('inbox/Plan.md') ?? 0) > before, true)
})
