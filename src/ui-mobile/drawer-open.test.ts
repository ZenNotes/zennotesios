import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DRAWER_CLOSE_MS, openDrawerRowToRead } from './drawer-open.ts'
import { KeyboardHold, READ_OPEN_SETTLE_MS } from './keyboard-hold.ts'

function clock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000_000
  return { now: () => t, advance: (ms) => { t += ms } }
}

/** read-open.ts's openToRead on the phone layout, over a hold the test owns. */
function openToReadWith(hold: KeyboardHold) {
  return async <T>(open: () => Promise<T>): Promise<T> => {
    hold.arm()
    try {
      return await open()
    } finally {
      hold.opened()
    }
  }
}

describe('openDrawerRowToRead', () => {
  it('holds the keyboard down from the tap to the note, the drawer closing included', async () => {
    const c = clock()
    const hold = new KeyboardHold(c.now)
    const refusedAt: Record<string, boolean> = {}
    await openDrawerRowToRead(
      async () => {
        refusedAt.open = hold.refuse()
        return 'Watering schedule.md'
      },
      {
        close: () => { refusedAt.close = hold.refuse() },
        wait: async (ms) => c.advance(ms),
        openToRead: openToReadWith(hold)
      }
    )
    // The editor taking the focus back as the drawer closes, and core's
    // focus after the open, are both refused.
    assert.deepEqual(refusedAt, { close: true, open: true })
    c.advance(24) // focusEditorNormalMode's retry cadence
    assert.equal(hold.refuse(), true)
    c.advance(READ_OPEN_SETTLE_MS)
    assert.equal(hold.refuse(), false)
  })

  it('closes the drawer before the note opens, a beat apart', async () => {
    const c = clock()
    const steps: string[] = []
    await openDrawerRowToRead(
      async () => { steps.push('open') },
      {
        close: () => steps.push('close'),
        wait: async (ms) => { steps.push(`wait ${ms}`); c.advance(ms) },
        openToRead: openToReadWith(new KeyboardHold(c.now))
      }
    )
    assert.deepEqual(steps, ['close', `wait ${DRAWER_CLOSE_MS}`, 'open'])
  })

  it('lets a tap into the text raise the keyboard once the note is open', async () => {
    const c = clock()
    const hold = new KeyboardHold(c.now)
    await openDrawerRowToRead(async () => undefined, {
      close: () => {},
      wait: async (ms) => c.advance(ms),
      openToRead: openToReadWith(hold)
    })
    hold.release() // the touch on the text
    assert.equal(hold.refuse(), false)
  })
})
