import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadMobileModule } from '../../tooling/load-mobile-module.ts'

// Before core 2.68.0 the demo tour named its notes "NN <U+2014> Title"; it now
// writes "NN Title". Desktop's vault.ts removes and replaces the notes under
// either name, and a tour seeded by an older build (on this phone, or synced
// from a desktop) must not survive Remove or come back doubled by Regenerate.
// Both delete what they match, so the match is exact: only the old separator,
// and only a name that becomes one of the tour's own notes.
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } })
const { MobileVault, DEMO_TOUR_NOTES, DEMO_TOUR_ASSETS } = await loadMobileModule([
  './src/bridge/vault-fs', '@zennotes/shared-domain/demo-tour-data'
])

/** The NativeFs surface the tour uses. Like the providers, a delete of a
 *  missing file fails. */
class MemoryFs {
  files = new Map<string, string>()
  directories = new Set<string>()
  async mkdir(path: string): Promise<void> { this.directories.add(path) }
  async writeText(path: string, body: string): Promise<void> { this.files.set(path, body) }
  async deleteFile(path: string): Promise<void> {
    if (!this.files.delete(path)) throw new Error(`File does not exist: ${path}`)
  }
  async rmdir(path: string): Promise<void> {
    for (const key of [...this.files.keys()]) if (key === path || key.startsWith(`${path}/`)) this.files.delete(key)
    for (const key of [...this.directories]) if (key === path || key.startsWith(`${path}/`)) this.directories.delete(key)
  }
  async readdir(path: string): Promise<{ name: string; type: 'file' | 'directory' }[]> {
    const names = new Map<string, 'file' | 'directory'>()
    for (const key of this.files.keys()) {
      if (!key.startsWith(`${path}/`)) continue
      const rest = key.slice(path.length + 1)
      const slash = rest.indexOf('/')
      names.set(slash < 0 ? rest : rest.slice(0, slash), slash < 0 ? 'file' : 'directory')
    }
    // Like Filesystem.readdir, an empty folder is listed too.
    for (const key of this.directories) {
      if (!key.startsWith(`${path}/`)) continue
      const [name] = key.slice(path.length + 1).split('/')
      if (name && !names.has(name)) names.set(name, 'directory')
    }
    return [...names].map(([name, type]) => ({ name, type }))
  }
}

const currentPaths: string[] = DEMO_TOUR_NOTES.map((note: { path: string }) => note.path)
const olderName = (path: string): string => path.replace(/^(inbox\/demo\/\d{2}b?) /, '$1 \u2014 ')
// Only a note named "NN Title" or "NNb Title" can have had the older name;
// one added since, like "05c D2 Diagrams", never did.
const renamedPaths = currentPaths.filter((path) => olderName(path) !== path)
const assetPaths = new Set<string>(DEMO_TOUR_ASSETS.map((asset: { path: string }) => asset.path))

/** The user's own notes beside the tour. Each looks related, and none is the
 *  tour's: a tour title behind a middle dot or an en dash instead of the old
 *  separator, the old separator in front of a title the tour never had, and a
 *  plain note. Remove and Regenerate must leave every one byte for byte. */
const USER_NOTES = new Map<string, string>([
  ['inbox/demo/00 \u00b7 Start Here.md', '# Middle dot\n'],
  ['inbox/demo/01 \u2013 Markdown Basics.md', '# En dash\n'],
  ['inbox/demo/99 \u2014 Not from the tour.md', '# Old separator, own title\n'],
  ['inbox/demo/My own note.md', '# Mine\n']
])

function vaultWith(paths: (path: string) => string) {
  const fs = new MemoryFs()
  for (const note of DEMO_TOUR_NOTES) fs.files.set(paths(note.path), note.body)
  for (const asset of DEMO_TOUR_ASSETS) fs.files.set(asset.path, asset.body)
  for (const [path, body] of USER_NOTES) fs.files.set(path, body)
  const vault = new MobileVault('Fixture')
  Object.assign(vault, { fs, ensureVaultLayout: async () => {} })
  return { fs, vault }
}

const tourNotesOnDisk = (fs: MemoryFs): string[] =>
  [...fs.files.keys()].filter((key) => key.startsWith('inbox/demo/') && !USER_NOTES.has(key) && !assetPaths.has(key)).sort()

function assertUserNotesKept(fs: MemoryFs): void {
  for (const [path, body] of USER_NOTES) assert.equal(fs.files.get(path), body, `${path} was touched`)
}

test('the older names are the tour notes behind the old separator', () => {
  assert.equal(currentPaths.length, 22)
  assert.ok(renamedPaths.includes('inbox/demo/00 Start Here.md'))
  assert.ok(!renamedPaths.includes('inbox/demo/05c D2 Diagrams.md'))
})

test('removing the tour deletes the notes it wrote under their older names', async () => {
  const { fs, vault } = vaultWith(olderName)

  const result = await vault.removeDemoTour()

  assert.deepEqual(tourNotesOnDisk(fs), [])
  for (const asset of DEMO_TOUR_ASSETS) assert.equal(fs.files.has(asset.path), false)
  assertUserNotesKept(fs)
  // The core unlinks every reported path, so the older names must be in it.
  assert.deepEqual(
    [...result.notePaths].sort(),
    [...currentPaths, ...renamedPaths.map(olderName)].sort()
  )
})

test('regenerating replaces a tour seeded under the older names instead of adding a second copy', async () => {
  const { fs, vault } = vaultWith(olderName)

  const result = await vault.generateDemoTour()

  assert.deepEqual(tourNotesOnDisk(fs), [...currentPaths].sort())
  for (const note of DEMO_TOUR_NOTES) assert.equal(fs.files.get(note.path), note.body)
  assertUserNotesKept(fs)
  assert.deepEqual(result.notePaths, currentPaths)
})

test('a tour under the current names is removed as before', async () => {
  const { fs, vault } = vaultWith((path) => path)

  const result = await vault.removeDemoTour()

  assert.deepEqual(tourNotesOnDisk(fs), [])
  assertUserNotesKept(fs)
  assert.deepEqual(result.notePaths, currentPaths)
})

test('removing the tour takes the sample database folder with it', async () => {
  // Core 2.71.0 ships a database, which is a folder of its own; the tour
  // folder could not go while that folder stayed behind.
  const fs = new MemoryFs()
  const vault = new MobileVault('Fixture')
  Object.assign(vault, { fs, ensureVaultLayout: async () => {} })

  await vault.generateDemoTour()
  assert.ok(fs.directories.has('inbox/demo/Reading List.base'))
  await vault.removeDemoTour()

  assert.equal(fs.directories.has('inbox/demo/Reading List.base'), false)
  assert.equal(fs.directories.has('inbox/demo'), false)
})
