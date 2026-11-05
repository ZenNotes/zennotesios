import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const shell = readFileSync(new URL('./MobileShell.tsx', import.meta.url), 'utf8')
const table = readFileSync(new URL('../../node_modules/@zennotes/app-core/dist/lib/cm-table.js', import.meta.url), 'utf8')

describe('a link in a table cell on a touch screen', () => {
  it('core still marks the cell and reads the target off the anchor', () => {
    assert.match(table, /dataset\.rendered/)
    assert.match(table, /anchor\.dataset\.wikilink/)
    assert.match(table, /classList\.contains\('wikilink'\)/)
  })

  it('follows on the touch, with the same target the cell would follow', () => {
    assert.match(shell, /TABLE_CELL_LINK = '\.cm-table-cell\[data-rendered="true"\] a\.wikilink'/)
    assert.match(shell, /cellLink\.dataset\.wikilink/)
  })
})
