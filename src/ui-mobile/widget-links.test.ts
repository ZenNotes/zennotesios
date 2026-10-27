import assert from 'node:assert/strict'
import test from 'node:test'
import { isIsoDay, isSafeVaultPath, parseWidgetLink } from './widget-links.ts'

test('the action links parse by host', () => {
  assert.deepEqual(parseWidgetLink('zennotes://new'), { kind: 'new' })
  assert.deepEqual(parseWidgetLink('zennotes://tasks'), { kind: 'tasks' })
  assert.deepEqual(parseWidgetLink('zennotes://home'), { kind: 'home' })
  assert.deepEqual(parseWidgetLink('  zennotes://NEW  '), { kind: 'new' })
  assert.deepEqual(parseWidgetLink('zennotes:new'), { kind: 'new' })
})

test('open carries a decoded vault path', () => {
  assert.deepEqual(parseWidgetLink('zennotes://open?path=inbox%2FMeeting%20notes.md'), {
    kind: 'open',
    path: 'inbox/Meeting notes.md'
  })
  assert.deepEqual(parseWidgetLink('zennotes://open?path=Ideas%20%26%20plans.md'), {
    kind: 'open',
    path: 'Ideas & plans.md'
  })
  assert.equal(parseWidgetLink('zennotes://open'), null)
  assert.equal(parseWidgetLink('zennotes://open?path='), null)
})

test('task carries the VaultTask id; the path is explicit or derived from the id', () => {
  assert.deepEqual(
    parseWidgetLink('zennotes://task?id=inbox%2FA.md%233&path=inbox%2FA.md'),
    { kind: 'task', id: 'inbox/A.md#3', path: 'inbox/A.md' }
  )
  assert.deepEqual(parseWidgetLink('zennotes://task?id=quick%2FQ.md%230'), {
    kind: 'task',
    id: 'quick/Q.md#0',
    path: 'quick/Q.md'
  })
  assert.equal(parseWidgetLink('zennotes://task?id=%230'), null)
  assert.equal(parseWidgetLink('zennotes://task'), null)
})

test('unsafe paths are refused', () => {
  assert.equal(isSafeVaultPath('inbox/a.md'), true)
  assert.equal(isSafeVaultPath('a.md'), true)
  assert.equal(isSafeVaultPath(''), false)
  assert.equal(isSafeVaultPath('/etc/passwd'), false)
  assert.equal(isSafeVaultPath('../secret.md'), false)
  assert.equal(isSafeVaultPath('inbox/../../x.md'), false)
  assert.equal(isSafeVaultPath('inbox//x.md'), false)
  assert.equal(isSafeVaultPath('inbox/./x.md'), false)
  assert.equal(isSafeVaultPath('inbox\\x.md'), false)
  assert.equal(parseWidgetLink('zennotes://open?path=..%2Fsecret.md'), null)
})

test('other schemes, unknown actions, and the Cloud auth callback are not ours', () => {
  assert.equal(parseWidgetLink('zennotes://auth?code=abc&state=xyz'), null)
  assert.equal(parseWidgetLink('zennotes://settings'), null)
  assert.equal(parseWidgetLink('https://zennotes.org/open?path=a.md'), null)
  assert.equal(parseWidgetLink('not a url'), null)
  assert.equal(parseWidgetLink(''), null)
})

test('calendar opens on a real day, or on its own choice', () => {
  assert.deepEqual(parseWidgetLink('zennotes://calendar'), { kind: 'calendar', date: null, add: false })
  assert.deepEqual(parseWidgetLink('zennotes://calendar?date=2026-10-27&add=1'), {
    kind: 'calendar',
    date: '2026-10-27',
    add: true
  })
  assert.deepEqual(parseWidgetLink('zennotes://calendar?date=2026-02-30'), { kind: 'calendar', date: null, add: false })
})

test('day and week need a real day', () => {
  assert.deepEqual(parseWidgetLink('zennotes://day?date=2026-10-27'), { kind: 'day', date: '2026-10-27' })
  assert.deepEqual(parseWidgetLink('zennotes://week?date=2026-10-26'), { kind: 'week', date: '2026-10-26' })
  assert.equal(parseWidgetLink('zennotes://day'), null)
  assert.equal(parseWidgetLink('zennotes://day?date=27-10-2026'), null)
  assert.equal(parseWidgetLink('zennotes://week?date=2026-13-01'), null)
  assert.equal(isIsoDay('2028-02-29'), true)
  assert.equal(isIsoDay('2026-02-29'), false)
})
