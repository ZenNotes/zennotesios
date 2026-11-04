import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { closesCardField } from './board-card-return.ts'

const enter = { key: 'Enter', isComposing: false, keyCode: 13 }

describe('Return in a Board card field', () => {
  it('closes an empty field, spaces counting as empty', () => {
    assert.equal(closesCardField(enter, ''), true)
    assert.equal(closesCardField(enter, '   '), true)
  })

  it('leaves a typed title to core, which adds the card', () => {
    assert.equal(closesCardField(enter, 'Card one'), false)
  })

  it('stays out of a composition and any other key', () => {
    assert.equal(closesCardField({ ...enter, isComposing: true }, ''), false)
    assert.equal(closesCardField({ ...enter, keyCode: 229 }, ''), false)
    assert.equal(closesCardField({ key: 'a', isComposing: false, keyCode: 65 }, ''), false)
  })

  it('core still names the field and closes it on Escape', () => {
    const board = readFileSync(new URL('../../node_modules/@zennotes/app-core/dist/components/DatabaseBoardView.js', import.meta.url), 'utf8')
    assert.match(board, /`New card in \$\{columnLabel\(col\.key\)\}`/)
    assert.match(board, /key === ['"]Escape['"][^]{0,300}closeAddCard\(\)/)
  })
})
