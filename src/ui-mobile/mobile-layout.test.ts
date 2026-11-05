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
    assert.equal(declaration(`.zn-mobile.zn-kb-open:not(.zn-kb-hardware) ${part}`, 'display'), 'none', part)
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
    '.zn-mobile.zn-phone .z-palette > [role=\'dialog\']',
    '.zn-mobile.zn-phone [data-zn-settings]'
  ]) {
    const padding = declaration(selector, 'padding') ?? ''
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      assert.ok(padding.includes(`env(safe-area-inset-${edge})`), `${selector} ${edge}`)
    }
  }
  const shell = declaration('.zn-mobile.zn-phone .zn-app-shell', 'padding') ?? ''
  for (const edge of ['top', 'right', 'left']) {
    assert.ok(shell.includes(`env(safe-area-inset-${edge})`), `app shell ${edge}`)
  }
  for (const selector of ['.zn-mobile-sheet', '.zn-phone .zn-mobile-drawer', '.zn-onboard']) {
    assert.ok(declaration(selector, 'padding')?.includes('env(safe-area-inset-left)'), selector)
  }
})

// Padding the shell's bottom left a blank strip under every view, above the
// home indicator (ZenNotes/zennotes#1035). Views run to the screen edge and
// their scrollers end with the clearance, so the last line still scrolls
// clear; sheets that pad the indicator themselves add none.
test('views run under the home indicator and their scrollers end clear of it', () => {
  const shell = '.zn-mobile.zn-phone .zn-app-shell'
  assert.ok(!(declaration(shell, 'padding') ?? '').includes('safe-area-inset-bottom'))
  assert.equal(declaration(shell, '--zn-shell-bottom'), 'calc(0.75rem + env(safe-area-inset-bottom))')
  for (const scroller of [
    `${shell} [class~='flex-1'][class*='overflow-y-auto']::after`,
    `${shell} [class~='flex-1'][class~='overflow-auto']::after`,
    `${shell} [data-preview-scroll]::after`
  ]) {
    assert.equal(declaration(scroller, 'height'), 'var(--zn-shell-bottom)', scroller)
  }
  assert.equal(declaration('.zn-mobile.zn-phone section.glass-column', '--zn-shell-bottom'), '0px')
  assert.equal(declaration('.zn-mobile.zn-phone [data-connections-panel]', '--zn-shell-bottom'), '0px')
  assert.equal(declaration('.zn-mobile.zn-phone.zn-kb-open .zn-app-shell', '--zn-shell-bottom'), '0px')
  // Cloud's attention row is the last thing in the shell: it carries the
  // clearance under its 44px, so its action stays where the circle expects it.
  let row = false
  css.walkRules((rule) => {
    if (!rule.selector.includes('div.h-8.shrink-0.justify-between.text-xs:has(')) return
    rule.walkDecls('padding-bottom', (decl) => { row = decl.value === 'var(--zn-shell-bottom, 0px)' })
  })
  assert.ok(row, 'the Cloud row pads the home indicator itself')
})

test('a select row stacked in a column keeps its height; one on a toolbar line still fills it', () => {
  assert.equal(declaration('.zn-mobile.zn-phone .zn-app-shell div:has(> select)', 'flex'), '1')
  assert.equal(declaration('.zn-mobile.zn-phone .zn-app-shell .flex-col > div:has(> select)', 'flex'), 'none')
})

test('the date calendar hides its key help on phones and keeps Today on the right', () => {
  const hint = '.zn-mobile.zn-phone [data-date-picker] div.justify-between > span:first-child:not([data-date-picker-month])'
  assert.equal(declaration(hint, 'display'), 'none')
  assert.equal(declaration(`${hint} + button`, 'margin-left'), 'auto')
})

test("the Calendar sheet is the date calendar's full-screen phone sheet, with finger-sized days", () => {
  const panel = '.zn-mobile.zn-phone .zn-calendar-sheet > [data-calendar-panel]'
  assert.equal(declaration(panel, 'position'), 'fixed')
  assert.ok(declaration(panel, 'width')?.includes('100vw'))
  assert.equal(declaration('.zn-mobile.zn-phone .zn-calendar-sheet button[data-cal-day]', 'min-height'), '42px')
})

test('a palette sub-list\'s Back row ends before the shell\'s Cancel', () => {
  assert.equal(declaration(".zn-mobile.zn-phone .z-palette [role='dialog'] div:has(> button[aria-label='Back to commands'])", 'padding-right'), '5rem')
  // The caption wraps; "‹ Back" stays on one line beside it.
  assert.equal(declaration(".zn-mobile.zn-phone .z-palette button[aria-label='Back to commands']", 'white-space'), 'nowrap')
  assert.equal(declaration(".zn-mobile.zn-phone .z-palette button[aria-label='Back to commands']", 'flex-shrink'), '0')
  const palette = readFileSync(new URL('../../node_modules/@zennotes/app-core/dist/components/CommandPalette.js', import.meta.url), 'utf8')
  assert.match(palette, /"aria-label": "Back to commands"/)
})

test("a database's selection bar fits a phone: the count on its own line, the actions under it", () => {
  assert.equal(declaration('.zn-mobile.zn-phone [data-db-selection-bar]', 'flex-wrap'), 'wrap')
  assert.equal(declaration('.zn-mobile.zn-phone [data-db-selection-bar] > span:first-child', 'flex-basis'), '100%')
  // Both of core's bars (rows selected, and editing picks) open with the count's span.
  const table = readFileSync(new URL('../../node_modules/@zennotes/app-core/dist/components/DatabaseTableView.js', import.meta.url), 'utf8')
  assert.equal(table.match(/"data-db-selection-bar": true, className: "flex [^"]*", children: \[_jsxs\("span"/g)?.length, 2)
  assert.match(table, /children: "Clear"/)
})
