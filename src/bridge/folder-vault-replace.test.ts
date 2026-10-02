import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FOLDER_VAULT_HINT,
  folderVaultReplaceNotice,
  pickAfterReplaceNotice
} from './folder-vault-replace.ts'

test('with no Files folder vault set a pick replaces nothing, so nothing is asked', () => {
  assert.equal(folderVaultReplaceNotice(null), null)
})

test('the question names the folder vault, what stays in Files, and the way back', () => {
  assert.deepEqual(folderVaultReplaceNotice({ name: 'Documents' }), {
    title: 'Replace your Files folder vault?',
    body:
      'ZenNotes keeps one Files folder vault at a time. Choosing a new folder removes “Documents” ' +
      'from your vaults list. Its notes stay in Files, and you can choose that folder again anytime.',
    confirmLabel: 'Choose New Folder',
    cancelLabel: 'Cancel'
  })
  assert.equal(FOLDER_VAULT_HINT, 'One Files folder at a time')
})

test('the copy carries no em dash (house style)', () => {
  const notice = folderVaultReplaceNotice({ name: 'Documents' })
  assert.ok(notice)
  for (const text of [...Object.values(notice), FOLDER_VAULT_HINT]) {
    assert.equal(text.includes(String.fromCodePoint(0x2014)), false)
  }
})

test('Cancel never opens the picker', async () => {
  const asked: string[] = []
  let picks = 0
  const result = await pickAfterReplaceNotice(
    { name: 'Documents' },
    async (notice) => {
      asked.push(notice.title)
      return false
    },
    async () => {
      picks += 1
      return 'Notes'
    }
  )
  assert.equal(result, null)
  assert.equal(picks, 0)
  assert.deepEqual(asked, ['Replace your Files folder vault?'])
})

test('Choose New Folder opens the picker once and hands back what was picked', async () => {
  let picks = 0
  const result = await pickAfterReplaceNotice(
    { name: 'Documents' },
    async () => true,
    async () => {
      picks += 1
      return 'Notes'
    }
  )
  assert.equal(result, 'Notes')
  assert.equal(picks, 1)
})

test('the first folder vault opens the picker without a question', async () => {
  let asked = 0
  let picks = 0
  const result = await pickAfterReplaceNotice(
    null,
    async () => {
      asked += 1
      return false
    },
    async () => {
      picks += 1
      return 'Documents'
    }
  )
  assert.equal(result, 'Documents')
  assert.equal(asked, 0)
  assert.equal(picks, 1)
})
