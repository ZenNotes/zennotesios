import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import postcss from 'postcss'

const css = postcss.parse(readFileSync(new URL('./mobile.css', import.meta.url), 'utf8'))

/** The value `property` ends up with in rules naming `selector`, alone or in a group. */
function declaration(selector: string, property: string): string | undefined {
  let result: string | undefined
  css.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return
    rule.walkDecls(property, (decl) => { result = decl.value })
  })
  return result
}

test('the create row comes and goes with the dial: phone layout only, hidden by the keyboard (zennotesandroid#101)', () => {
  for (const part of ['.zn-mobile-fab', '.zn-mobile-fab-menu', '.zn-mobile-fab-create']) {
    assert.equal(declaration(part, 'display'), 'none', part)
    assert.equal(declaration(`.zn-phone ${part}`, 'display'), 'flex', part)
    assert.equal(declaration(`.zn-mobile.zn-kb-open ${part}`, 'display'), 'none', part)
  }
})

test('the create row sits on the ensō baseline, above the Cloud footer', () => {
  assert.equal(declaration('.zn-mobile-fab-create', 'bottom'), declaration('.zn-mobile-fab', 'bottom'))
  assert.ok(declaration('.zn-mobile-fab-create', 'bottom')?.includes('var(--zn-cloud-footer-height, 0px)'))
})

test('toasts on a phone sit where the dial column starts, clear of the ensō', () => {
  assert.equal(declaration('.zn-phone [data-toast-host]', 'bottom'), declaration('.zn-mobile-fab-menu', 'bottom'))
  assert.equal(declaration('.zn-phone [data-toast-host]', 'align-items'), 'center')
})
