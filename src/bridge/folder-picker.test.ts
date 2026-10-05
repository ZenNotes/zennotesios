import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadMobileModule } from '../../tooling/load-mobile-module.ts'

// The real folder-picker.ts, with the native FolderPicker and the storage
// tier replaced, so each test sees which bookmark iOS is asked to resolve.
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key)
  }
})

// The single slot every earlier version kept its one folder vault in.
const SLOT_KEY = 'zn-mobile:external-vault'

type PickResult = { cancelled: boolean; url?: string; name?: string; bookmark?: string }
type Resolved = { url: string; name: string; bookmark?: string }

const ICLOUD_DOCUMENTS = 'file:///private/var/mobile/Library/Mobile%20Documents/com~apple~CloudDocs/Documents/'
const ON_DEVICE = 'file:///private/var/mobile/Containers/Shared/AppGroup/1F2E/File%20Provider%20Storage'
const documents = { name: 'Documents', bookmark: 'bookmark-documents' }
const pickNotes: PickResult = {
  cancelled: false,
  url: `${ON_DEVICE}/Notes/`,
  name: 'Notes',
  bookmark: 'bookmark-notes'
}
const pickWork: PickResult = {
  cancelled: false,
  url: `${ON_DEVICE}/Work/`,
  name: 'Work',
  bookmark: 'bookmark-work'
}

let nextPick: PickResult = pickNotes
let picks = 0
const resolvable = new Map<string, Resolved | Error>()
const resolveCalls: string[] = []
// Runs while iOS is resolving a bookmark, before the answer comes back.
let duringResolve: (() => void) | null = null
const tiers: string[] = []

const picker = await loadMobileModule('./src/bridge/folder-picker.ts', {
  '@capacitor/core': {
    registerPlugin: () => ({
      pickFolder: async () => {
        picks += 1
        return nextPick
      },
      resolveBookmark: async ({ bookmark }: { bookmark: string }) => {
        resolveCalls.push(bookmark)
        duringResolve?.()
        const result = resolvable.get(bookmark)
        if (!result || result instanceof Error) throw result ?? new Error(`unknown bookmark ${bookmark}`)
        return result
      }
    })
  },
  './icloud': { setStoragePref: (tier: string) => void tiers.push(tier) }
})

/** A fresh install state, or one where an earlier version kept `single`. */
function start(single: { name: string; bookmark: string } | null = null): void {
  store.clear()
  if (single) store.set(SLOT_KEY, JSON.stringify(single))
  nextPick = pickNotes
  picks = 0
  resolvable.clear()
  resolvable.set('bookmark-documents', { url: ICLOUD_DOCUMENTS, name: 'Documents' })
  resolvable.set('bookmark-notes', { url: `${ON_DEVICE}/Notes/`, name: 'Notes' })
  resolvable.set('bookmark-work', { url: `${ON_DEVICE}/Work/`, name: 'Work' })
  resolveCalls.length = 0
  duringResolve = null
  tiers.length = 0
}

function names(): string[] {
  return picker.getExternalVaultRefs().map((ref: { name: string }) => ref.name)
}

function rootOf(name: string): string {
  const ref = picker.getExternalVaultRefs().find((r: { name: string }) => r.name === name)
  assert.ok(ref, `${name} is not listed`)
  return picker.externalVaultRoot(ref.id)
}

async function pick(next: PickResult): Promise<unknown> {
  nextPick = next
  return await picker.pickExternalVault()
}

test('an install with no folder vault starts with an empty list', () => {
  start()
  assert.deepEqual(picker.getExternalVaultRefs(), [])
  assert.equal(picker.getExternalVaultRef(), null)
  assert.equal(picker.currentExternalVaultRoot(), null)
})

test('the folder vault an earlier version kept moves into the list with its bookmark bytes', () => {
  start(documents)
  const refs = picker.getExternalVaultRefs()
  assert.equal(refs.length, 1)
  assert.equal(refs[0].name, 'Documents')
  assert.equal(refs[0].bookmark, 'bookmark-documents')
  assert.equal(typeof refs[0].id, 'string')
  assert.ok(refs[0].id)
  // Still the current folder vault, under an identity that holds across reads.
  assert.equal(picker.getExternalVaultRef()?.id, refs[0].id)
  assert.deepEqual(picker.getExternalVaultRefs(), refs)
  assert.equal(picker.currentExternalVaultRoot(), picker.externalVaultRoot(refs[0].id))
})

test('choosing another folder adds it and keeps the folder already listed', async () => {
  start(documents)
  const result = await pick(pickNotes)
  assert.deepEqual(result, { url: `${ON_DEVICE}/Notes/`, name: 'Notes' })
  assert.equal(picks, 1)
  assert.deepEqual(names(), ['Documents', 'Notes'])
  assert.equal(picker.getExternalVaultRefs()[0].bookmark, 'bookmark-documents')
  assert.equal(picker.getExternalVaultRef()?.name, 'Notes')
  assert.deepEqual(tiers, ['external'])
  // The single slot names the current folder the way an earlier version reads it.
  const slot = JSON.parse(store.get(SLOT_KEY)!)
  assert.equal(slot.name, 'Notes')
  assert.equal(slot.bookmark, 'bookmark-notes')
})

test('a cancelled pick changes nothing', async () => {
  start(documents)
  const before = picker.getExternalVaultRefs()
  assert.equal(await pick({ cancelled: true }), null)
  assert.deepEqual(picker.getExternalVaultRefs(), before)
  assert.equal(picker.getExternalVaultRef()?.name, 'Documents')
  assert.deepEqual(tiers, [])
})

test('switching opens a listed folder through its own bookmark and makes it current', async () => {
  start(documents)
  await pick(pickNotes)
  resolveCalls.length = 0
  tiers.length = 0
  const opened = await picker.selectExternalVault(rootOf('Documents'))
  assert.deepEqual(opened, { url: ICLOUD_DOCUMENTS, name: 'Documents' })
  assert.deepEqual(resolveCalls, ['bookmark-documents'])
  assert.equal(picker.getExternalVaultRef()?.name, 'Documents')
  assert.equal(picker.currentExternalVaultRoot(), rootOf('Documents'))
  assert.deepEqual(tiers, ['external'])
  assert.deepEqual(names(), ['Documents', 'Notes'])
})

test('the bare root token from before the list still opens the current folder', async () => {
  start(documents)
  const opened = await picker.selectExternalVault(picker.EXTERNAL_VAULT_ROOT)
  assert.deepEqual(opened, { url: ICLOUD_DOCUMENTS, name: 'Documents' })
  assert.equal(picker.isExternalVaultRoot(picker.EXTERNAL_VAULT_ROOT), true)
  assert.equal(picker.isExternalVaultRoot(rootOf('Documents')), true)
  assert.equal(picker.isExternalVaultRoot('zn://vaults/My Vault'), false)
})

test('a root that names no listed folder opens nothing', async () => {
  start(documents)
  assert.equal(await picker.selectExternalVault(`${picker.EXTERNAL_VAULT_ROOT_PREFIX}gone`), null)
  assert.deepEqual(resolveCalls, [])
  assert.deepEqual(tiers, [])
})

test('a folder iOS cannot reopen stays listed and does not become current', async () => {
  start(documents)
  await pick(pickNotes)
  tiers.length = 0
  resolvable.set('bookmark-documents', new Error('The folder is gone'))
  assert.equal(await picker.selectExternalVault(rootOf('Documents')), null)
  assert.equal(picker.getExternalVaultRef()?.name, 'Notes')
  assert.deepEqual(names(), ['Documents', 'Notes'])
  assert.deepEqual(tiers, [])
})

test('a folder removed while its bookmark resolves is not reopened or listed again', async () => {
  start(documents)
  await pick(pickNotes)
  const root = rootOf('Documents')
  tiers.length = 0
  duringResolve = () => picker.forgetExternalVault(root)
  assert.equal(await picker.selectExternalVault(root), null)
  assert.deepEqual(names(), ['Notes'])
  assert.equal(picker.getExternalVaultRef()?.name, 'Notes')
  assert.deepEqual(tiers, [])
})

test('removing one folder leaves the others and the current one as they were', async () => {
  start(documents)
  await pick(pickWork)
  await pick(pickNotes)
  const before = picker.getExternalVaultRefs()
  picker.forgetExternalVault(rootOf('Work'))
  assert.deepEqual(names(), ['Documents', 'Notes'])
  picker.forgetExternalVault(rootOf('Documents'))
  assert.deepEqual(picker.getExternalVaultRefs(), before.filter((r: { name: string }) => r.name === 'Notes'))
  assert.equal(picker.getExternalVaultRef()?.name, 'Notes')
})

test('removing the current folder clears the pointer and it does not come back', async () => {
  start(documents)
  await pick(pickNotes)
  picker.forgetExternalVault(rootOf('Notes'))
  assert.equal(picker.getExternalVaultRef(), null)
  assert.equal(store.has(SLOT_KEY), false)
  assert.deepEqual(names(), ['Documents'])
})

test('boot reopens the current folder and a refreshed stale bookmark is kept', async () => {
  start(documents)
  const root = picker.currentExternalVaultRoot()
  resolvable.set('bookmark-documents', {
    url: ICLOUD_DOCUMENTS,
    name: 'Documents',
    bookmark: 'bookmark-documents-fresh'
  })
  assert.deepEqual(await picker.resolveExternalVault(), { url: ICLOUD_DOCUMENTS, name: 'Documents' })
  assert.equal(picker.getExternalVaultRef()?.bookmark, 'bookmark-documents-fresh')
  assert.equal(picker.currentExternalVaultRoot(), root)
  assert.equal(JSON.parse(store.get(SLOT_KEY)!).bookmark, 'bookmark-documents-fresh')
})

test('a folder renamed in Files keeps its place under its new name', async () => {
  start(documents)
  const root = picker.currentExternalVaultRoot()
  resolvable.set('bookmark-documents', { url: `${ON_DEVICE}/Papers/`, name: 'Papers' })
  assert.deepEqual(await picker.resolveExternalVault(), { url: `${ON_DEVICE}/Papers/`, name: 'Papers' })
  assert.deepEqual(names(), ['Papers'])
  assert.equal(picker.currentExternalVaultRoot(), root)
})

test('choosing a listed folder again refreshes its entry instead of listing it twice', async () => {
  start(documents)
  await picker.resolveExternalVault()
  await pick(pickNotes)
  const id = picker.getExternalVaultRefs()[0].id
  // The same folder, spelled without /private and without the trailing slash.
  await pick({
    cancelled: false,
    url: 'file:///var/mobile/Library/Mobile%20Documents/com~apple~CloudDocs/Documents',
    name: 'Documents',
    bookmark: 'bookmark-documents-2'
  })
  assert.deepEqual(names(), ['Documents', 'Notes'])
  const refs = picker.getExternalVaultRefs()
  assert.equal(refs[0].id, id)
  assert.equal(refs[0].bookmark, 'bookmark-documents-2')
  assert.equal(picker.getExternalVaultRef()?.id, id)
})

test('a carried-over folder is recognized by resolving its bookmark when chosen again', async () => {
  start(documents)
  await pick({ cancelled: false, url: ICLOUD_DOCUMENTS, name: 'Documents', bookmark: 'bookmark-documents-2' })
  assert.deepEqual(resolveCalls, ['bookmark-documents'])
  assert.deepEqual(names(), ['Documents'])
  assert.equal(picker.getExternalVaultRefs()[0].bookmark, 'bookmark-documents-2')
})

test('two folders with the same name are two vaults', async () => {
  start(documents)
  await pick({ cancelled: false, url: `${ON_DEVICE}/Documents/`, name: 'Documents', bookmark: 'bookmark-local' })
  assert.deepEqual(names(), ['Documents', 'Documents'])
  const [first, second] = picker.getExternalVaultRefs()
  assert.notEqual(first.id, second.id)
  assert.equal(first.bookmark, 'bookmark-documents')
  assert.equal(picker.currentExternalVaultRoot(), picker.externalVaultRoot(second.id))
})

test('a folder an earlier version wrote to the single slot joins the list', () => {
  start(documents)
  picker.getExternalVaultRefs()
  // After a downgrade, an earlier version picked Work and kept only the slot.
  store.set(SLOT_KEY, JSON.stringify({ name: 'Work', bookmark: 'bookmark-work' }))
  assert.equal(picker.getExternalVaultRef()?.name, 'Work')
  assert.deepEqual(names(), ['Documents', 'Work'])
  assert.equal(picker.getExternalVaultRef()?.id, picker.getExternalVaultRefs()[1].id)
})
