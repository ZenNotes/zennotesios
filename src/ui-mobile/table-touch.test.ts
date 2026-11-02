import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import postcss from 'postcss'

// Core 2.81.0 showed hover-only controls where nothing can hover, so on a phone
// the database Table's row Open sat over the end of every long name and a long
// title squeezed the always-shown select boxes. The shell hid the one and
// widened the other itself until core 2.81.1 did both; it carries no rule for
// either now, so these pin what it relies on.

const core = postcss.parse(
  readFileSync(new URL('../../node_modules/@zennotes/app-core/dist/styles/index.css', import.meta.url), 'utf8')
)
const table = readFileSync(
  new URL('../../node_modules/@zennotes/app-core/dist/components/DatabaseTableView.js', import.meta.url),
  'utf8'
)

/** The declaration core applies to a selector on a screen that cannot hover. */
function whereNothingHovers(selector: string, property: string): postcss.Declaration | undefined {
  let result: postcss.Declaration | undefined
  core.walkAtRules('media', (media) => {
    if (media.params !== 'not all and (hover: hover) and (pointer: fine)') return
    media.walkRules((rule) => {
      if (!rule.selectors.includes(selector)) return
      rule.walkDecls(property, (decl) => { result = decl })
    })
  })
  return result
}

describe('the database Table on a phone', () => {
  it('has core drop the row Open that covered long names; the page glyph opens the page', () => {
    assert.match(table, /title: "Open page", className: "zn-hover-only absolute right-1\.5/)
    const display = whereNothingHovers('.zn-hover-only', 'display')
    assert.equal(display?.value, 'none')
    assert.equal(display?.important, true)
    assert.match(table, /title: hasContent \? 'Open page' : 'Open page \(empty\)', className: \[\s*'flex shrink-0/)
  })

  it('has core keep the select column wide enough for its box', () => {
    assert.match(table, /group\/sa w-10 min-w-10/)
    assert.match(table, /_jsx\("td", \{ className: "w-10 min-w-10 /)
  })
})
