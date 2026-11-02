import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import postcss from 'postcss'

// A long-press opens core's context menu with a synthesized contextmenu event,
// and the menu focuses itself as it mounts. WebKit draws its focus ring on a
// scripted focus that no tap came before, so the shell takes the ring off.

const css = postcss.parse(readFileSync(new URL('./mobile.css', import.meta.url), 'utf8'))
const shell = readFileSync(new URL('./MobileShell.tsx', import.meta.url), 'utf8')
const menu = readFileSync(
  new URL('../../node_modules/@zennotes/app-core/dist/components/ContextMenu.js', import.meta.url),
  'utf8'
)

function declaration(selector: string, property: string): string | undefined {
  let result: string | undefined
  css.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return
    rule.walkDecls(property, (decl) => { result = decl.value })
  })
  return result
}

describe('a long-pressed menu on a phone', () => {
  it('wears no focus ring', () => {
    assert.equal(declaration('.zn-mobile [data-ctx-menu]:focus-visible', 'outline'), 'none')
  })

  it('is opened by the shell with a synthesized contextmenu, not a tap', () => {
    assert.match(shell, /new MouseEvent\('contextmenu', \{/)
  })

  it('is core\'s focusable menu, which takes the focus as it mounts', () => {
    assert.match(menu, /"data-ctx-menu": true, role: "menu", "aria-label": title, tabIndex: -1/)
    assert.match(menu, /target\(\)\?\.focus\(\{ preventScroll: true \}\);/)
  })
})
