import assert from 'node:assert/strict'
import test from 'node:test'
import { parseThemeBackdropColor } from './keyboard-backdrop-color.ts'

test('parses the active theme background channels for the native keyboard backdrop', () => {
  assert.deepEqual(parseThemeBackdropColor('29 32 33'), {
    red: 29,
    green: 32,
    blue: 33
  })
  assert.deepEqual(parseThemeBackdropColor('  255   255  255  '), {
    red: 255,
    green: 255,
    blue: 255
  })
})

test('rejects missing, malformed, and out-of-range theme colors', () => {
  assert.equal(parseThemeBackdropColor(''), null)
  assert.equal(parseThemeBackdropColor('29 32'), null)
  assert.equal(parseThemeBackdropColor('29 32 black'), null)
  assert.equal(parseThemeBackdropColor('29 32 256'), null)
  assert.equal(parseThemeBackdropColor('-1 32 33'), null)
})
