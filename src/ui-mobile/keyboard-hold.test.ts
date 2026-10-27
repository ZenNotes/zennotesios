import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { KeyboardHold, READ_OPEN_SETTLE_MS, READ_OPEN_WAIT_MS } from './keyboard-hold.ts'

function clock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000_000
  return { now: () => t, advance: (ms) => { t += ms } }
}

describe('KeyboardHold', () => {
  it('lets every focus through until a note opens to be read', () => {
    const c = clock()
    const hold = new KeyboardHold(c.now)
    assert.equal(hold.refuse(), false)
  })

  it('refuses core\'s focus and its retries, then lets go', () => {
    const c = clock()
    const hold = new KeyboardHold(c.now)
    hold.arm()
    c.advance(400) // the note takes a while to open
    assert.equal(hold.refuse(), true)
    for (let i = 0; i < 10; i++) {
      c.advance(24) // focusEditorNormalMode's retry cadence
      assert.equal(hold.refuse(), true)
    }
    c.advance(READ_OPEN_SETTLE_MS)
    assert.equal(hold.refuse(), false)
  })

  it('lets a tap into the text through at once', () => {
    const c = clock()
    const hold = new KeyboardHold(c.now)
    hold.arm()
    assert.equal(hold.refuse(), true)
    hold.release()
    assert.equal(hold.refuse(), false)
  })

  it('does not wait forever for a focus that never comes', () => {
    const c = clock()
    const hold = new KeyboardHold(c.now)
    hold.arm()
    c.advance(READ_OPEN_WAIT_MS)
    assert.equal(hold.active, false)
    assert.equal(hold.refuse(), false)
  })

  it('stops waiting soon after an open it was told about finishes', () => {
    const c = clock()
    const hold = new KeyboardHold(c.now)
    hold.arm()
    c.advance(100)
    hold.opened()
    c.advance(READ_OPEN_SETTLE_MS - 1)
    assert.equal(hold.active, true)
    c.advance(1)
    assert.equal(hold.refuse(), false)
  })

  it('ignores an open that finishes after a touch released it', () => {
    const c = clock()
    const hold = new KeyboardHold(c.now)
    hold.arm()
    hold.release()
    hold.opened()
    assert.equal(hold.refuse(), false)
  })
})
