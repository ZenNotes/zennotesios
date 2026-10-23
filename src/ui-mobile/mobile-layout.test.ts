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

// The page draws edge to edge (viewport-fit=cover, contentInset never), so
// nothing may paint into an inset: Review sync changes left its last lines
// under the home indicator, and in landscape the sensor housing covered the
// editor, the sheets and the dialogs. Same contract as the Android shell's.
test('dialog sheets keep their content out of the home indicator and the sensor housing', () => {
  const sheet = ".zn-mobile.zn-phone .z-modal[role='presentation'] > [role='dialog']"
  assert.equal(declaration(sheet, 'padding-bottom'), 'env(safe-area-inset-bottom)')
  assert.equal(declaration(sheet, 'padding-left'), 'env(safe-area-inset-left)')
  assert.equal(declaration(sheet, 'padding-right'), 'env(safe-area-inset-right)')
  // overflow:hidden would clip at the padding edge and let overflow paint
  // into the inset; a scroll puts the padding at the end instead.
  assert.equal(declaration(sheet, 'overflow-y'), 'auto')
  const block = `${sheet}:not(.flex):not(.grid)`
  assert.equal(declaration(block, 'display'), 'flex')
  assert.equal(declaration(block, 'flex-direction'), 'column')
  let scrollerShrinks = false
  css.walkRules((rule) => {
    if (rule.selector.includes(':not(.flex):not(.grid)') && rule.selector.includes('overflow-y-auto')) {
      rule.walkDecls('min-height', (decl) => { scrollerShrinks = decl.value === '0' })
    }
  })
  assert.ok(scrollerShrinks, 'a vh-capped scroller in a block panel must be able to shrink')
})

test('full-screen phone surfaces clear every inset edge, landscape sides included', () => {
  for (const selector of [
    '.zn-mobile.zn-phone .zn-app-shell',
    '.zn-mobile.zn-phone .z-palette > [role=\'dialog\']',
    '.zn-mobile.zn-phone [data-zn-settings]'
  ]) {
    const padding = declaration(selector, 'padding') ?? ''
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      assert.ok(padding.includes(`env(safe-area-inset-${edge})`), `${selector} ${edge}`)
    }
  }
  for (const selector of ['.zn-mobile-sheet', '.zn-phone .zn-mobile-drawer', '.zn-onboard']) {
    assert.ok(declaration(selector, 'padding')?.includes('env(safe-area-inset-left)'), selector)
  }
})
