import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadMobileModule } from '../../tooling/load-mobile-module.ts'

// The real folder-picker.ts, with the native FolderPicker and the storage
// tier replaced, so each test sees exactly when the Files picker would open.
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key)
  }
})

type PickResult = { cancelled: boolean; url?: string; name?: string; bookmark?: string }
const notes: PickResult = { cancelled: false, url: 'file:///Notes', name: 'Notes', bookmark: 'bookmark-notes' }
let nextPick: PickResult = notes
let picks = 0
const tiers: string[] = []

const picker = await loadMobileModule('./src/bridge/folder-picker.ts', {
  '@capacitor/core': {
    registerPlugin: () => ({
      pickFolder: async () => {
        picks += 1
        return nextPick
      },
      resolveBookmark: async () => {
        throw new Error('not reached by a pick')
      }
    })
  },
  './icloud': { setStoragePref: (tier: string) => void tiers.push(tier) }
})

const documents = { name: 'Documents', bookmark: 'bookmark-documents' }

function start(current: typeof documents | null): void {
  store.clear()
  picker.setExternalVaultRef(current)
  nextPick = notes
  picks = 0
  tiers.length = 0
}

test('Cancel on the question never opens the Files picker and keeps the folder vault', async () => {
  start(documents)
  const asked: string[] = []
  const result = await picker.pickExternalVault(async (notice: { body: string }) => {
    asked.push(notice.body)
    return false
  })
  assert.equal(result, null)
  assert.equal(picks, 0)
  assert.deepEqual(picker.getExternalVaultRef(), documents)
  assert.deepEqual(tiers, [])
  assert.equal(asked.length, 1)
  assert.match(asked[0]!, /removes “Documents” from your vaults list/)
})

test('Choose New Folder opens the picker, and the new folder replaces the old one', async () => {
  start(documents)
  const result = await picker.pickExternalVault(async () => true)
  assert.deepEqual(result, { url: 'file:///Notes', name: 'Notes' })
  assert.equal(picks, 1)
  assert.deepEqual(picker.getExternalVaultRef(), { name: 'Notes', bookmark: 'bookmark-notes' })
  assert.deepEqual(tiers, ['external'])
})

test('the first folder vault is picked without a question', async () => {
  start(null)
  let asked = 0
  const result = await picker.pickExternalVault(async () => {
    asked += 1
    return false
  })
  assert.deepEqual(result, { url: 'file:///Notes', name: 'Notes' })
  assert.equal(asked, 0)
  assert.equal(picks, 1)
})

test('the New Vault sheet’s yes is not asked again, and it covers one pick only', async () => {
  start(documents)
  nextPick = { cancelled: true }
  let asked = 0
  const decline = async (): Promise<boolean> => {
    asked += 1
    return false
  }
  const release = picker.answerExternalVaultReplace(documents.bookmark)
  assert.equal(await picker.pickExternalVault(decline), null)
  release()
  assert.equal(asked, 0)
  assert.equal(picks, 1)
  assert.deepEqual(picker.getExternalVaultRef(), documents)

  assert.equal(await picker.pickExternalVault(decline), null)
  assert.equal(asked, 1)
  assert.equal(picks, 1)
})

test('a yes that no pick used is dropped by its release', async () => {
  start(documents)
  let asked = 0
  picker.answerExternalVaultReplace(documents.bookmark)()
  await picker.pickExternalVault(async () => {
    asked += 1
    return false
  })
  assert.equal(asked, 1)
  assert.equal(picks, 0)
})

test('a yes about another folder does not cover the one that is set', async () => {
  start(documents)
  let asked = 0
  const release = picker.answerExternalVaultReplace('bookmark-elsewhere')
  await picker.pickExternalVault(async () => {
    asked += 1
    return false
  })
  release()
  assert.equal(asked, 1)
  assert.equal(picks, 0)
})
