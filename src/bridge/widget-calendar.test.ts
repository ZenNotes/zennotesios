import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWidgetActions, seenLine, type WidgetAction } from './widget-calendar.ts'

const tick: WidgetAction = {
  at: 2,
  vaultKey: 'zn://vaults/My Vault',
  id: 'inbox/Daily/2026-10-27.md#0',
  path: 'inbox/Daily/2026-10-27.md',
  line: 4,
  raw: '- [ ] Buy Cougar Gold',
  toggled: '- [x] Buy Cougar Gold',
  checked: true,
  written: true
}

test('the log comes back oldest first, with written defaulting to false', () => {
  const { written: _w, ...unwritten } = tick
  const parsed = parseWidgetActions([tick, { ...unwritten, at: 1, checked: false }])
  assert.deepEqual(parsed.map((a) => [a.at, a.checked, a.written]), [
    [1, false, false],
    [2, true, true]
  ])
})

test('anything malformed from the native side is dropped, not trusted', () => {
  assert.deepEqual(parseWidgetActions(null), [])
  assert.deepEqual(parseWidgetActions({ actions: [tick] }), [])
  assert.deepEqual(
    parseWidgetActions([
      { ...tick, id: '' },
      { ...tick, path: 42 },
      { ...tick, at: Number.NaN },
      { ...tick, checked: 'yes' },
      { ...tick, raw: undefined },
      'tick',
      null
    ]),
    []
  )
})

test('core looks a task up by the line the widget showed before the tap', () => {
  assert.equal(seenLine(tick), '- [ ] Buy Cougar Gold')
  assert.equal(seenLine({ ...tick, checked: false }), '- [x] Buy Cougar Gold')
})
