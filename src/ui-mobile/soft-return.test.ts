import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dropsReturnShift, SOFT_KEYBOARD_MIN_HEIGHT, type ReturnKeyEvent } from './soft-return.ts'

const shiftedReturn: ReturnKeyEvent = {
  key: 'Enter',
  keyCode: 13,
  shiftKey: true,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  isTrusted: true
}
const KEYBOARD = 336

describe('Return on the soft keyboard at a sentence start', () => {
  it('drops the shift iOS sets for a capital', () => {
    assert.equal(dropsReturnShift(shiftedReturn, 'sentences', KEYBOARD), true)
  })

  it('leaves an unshifted Return, and every other key, to CodeMirror', () => {
    assert.equal(dropsReturnShift({ ...shiftedReturn, shiftKey: false }, 'sentences', KEYBOARD), false)
    assert.equal(dropsReturnShift({ ...shiftedReturn, key: 'Backspace', keyCode: 8 }, 'sentences', KEYBOARD), false)
    assert.equal(dropsReturnShift({ ...shiftedReturn, metaKey: true }, 'sentences', KEYBOARD), false)
  })

  it('keeps Shift+Return from a hardware keyboard, which leaves only its bar on screen', () => {
    assert.equal(dropsReturnShift(shiftedReturn, 'sentences', 0), false)
    assert.equal(dropsReturnShift(shiftedReturn, 'sentences', 55), false)
    assert.equal(dropsReturnShift(shiftedReturn, 'sentences', SOFT_KEYBOARD_MIN_HEIGHT), true)
  })

  it('keeps the shift where nothing capitalizes, as CodeMirror does', () => {
    assert.equal(dropsReturnShift(shiftedReturn, 'off', KEYBOARD), false)
    assert.equal(dropsReturnShift(shiftedReturn, 'none', KEYBOARD), false)
  })

  it('never touches the keydown it dispatches itself', () => {
    assert.equal(dropsReturnShift({ ...shiftedReturn, isTrusted: false }, 'sentences', KEYBOARD), false)
  })
})

describe('why the shell steps in', () => {
  const view = readFileSync(
    new URL('../../node_modules/@codemirror/view/dist/index.js', import.meta.url),
    'utf8'
  )

  it('CodeMirror drops the shift only while the visual viewport is under 85% of the page', () => {
    assert.match(view, /if \(mods\.shiftKey && browser\.ios && [^]{0,120}iosVirtualKeyboardOpen\(this\.view\.win\)\)\s+mods\.shiftKey = false;/)
    assert.match(view, /function iosVirtualKeyboardOpen\(win\) \{[^]{0,200}< 0\.85;/)
  })

  it('which never holds on a phone, where the web view itself shrinks', () => {
    const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8')
    assert.match(main, /mode: isPhoneDevice\(\) \? KeyboardResize\.Native : KeyboardResize\.None/)
    assert.match(main, /if \(isPhoneDevice\(\)\) installSoftReturn\(\)/)
  })
})
