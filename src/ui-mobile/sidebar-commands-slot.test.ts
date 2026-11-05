import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadMobileModule } from '../../tooling/load-mobile-module.ts'

const { SIDEBAR_HELP_BUTTON, sidebarCommandsSlot } = await loadMobileModule(['./src/ui-mobile/sidebar-commands-slot'])

// A small element tree with just enough querySelector for the selectors at stake:
// compounds of tag, .class and [attr="value"], joined by the child combinator.
interface Node { tagName: string; classes: string[]; attrs: Record<string, string>; children: Node[]; parent: Node | null }
function el(tag: string, classes: string[] = [], attrs: Record<string, string> = {}, children: Node[] = []): Node {
  const node: Node = { tagName: tag.toUpperCase(), classes, attrs, children, parent: null }
  for (const child of children) child.parent = node
  return node
}
function matches(node: Node, compound: string): boolean {
  const tag = /^[a-z]+/i.exec(compound)?.[0]
  if (tag && node.tagName !== tag.toUpperCase()) return false
  for (const [, cls] of compound.matchAll(/\.([\w-]+)/g)) if (!node.classes.includes(cls!)) return false
  for (const [, key, value] of compound.matchAll(/\[([\w-]+)="([^"]*)"\]/g)) if (node.attrs[key!] !== value) return false
  return true
}
function asElement(node: Node): Element {
  return {
    tagName: node.tagName,
    get previousElementSibling() {
      const siblings = node.parent?.children ?? []
      const at = siblings.indexOf(node)
      return at > 0 ? asElement(siblings[at - 1]!) : null
    }
  } as unknown as Element
}
function documentOf(root: Node) {
  const all: Node[] = []
  const walk = (n: Node) => { all.push(n); n.children.forEach(walk) }
  walk(root)
  return {
    querySelector(selector: string): Element | null {
      const compounds = selector.split('>').map((part) => part.trim())
      const hit = all.find((n) => {
        let at: Node | null = n
        for (let i = compounds.length - 1; i >= 0; i--) {
          if (!at || !matches(at, compounds[i]!)) return false
          at = at.parent
        }
        return true
      })
      return hit ? asElement(hit) : null
    }
  }
}

const help = () => el('button', [], { 'data-sidebar-idx': '12', 'data-sidebar-type': 'help' })
const settings = () => el('button', [], { 'data-sidebar-idx': '13', 'data-sidebar-type': 'settings' })
// The footer as core 9e989aad draws it on a phone or tablet: no Files action, so
// an empty cell first, and no zn-sidebar-footer-safe class any more.
const footer9e989aad = () =>
  el('aside', ['glass-sidebar'], {}, [
    el('div', ['mt-2', 'grid', 'h-16', 'items-center', 'gap-2', 'px-3'], {}, [el('div'), help(), settings()])
  ])

describe('the cell Commands takes in the iPad sidebar footer', () => {
  it('is found in the footer core 9e989aad draws, which lost its old class', () => {
    const doc = documentOf(footer9e989aad())
    assert.equal(doc.querySelector('.zn-sidebar-footer-safe > button[data-sidebar-type="help"]'), null)
    assert.equal(SIDEBAR_HELP_BUTTON, 'button[data-sidebar-type="help"]')
    assert.equal(sidebarCommandsSlot(doc)?.tagName, 'DIV')
  })

  it('is still found in the footer that carried the class', () => {
    const older = el('aside', [], {}, [el('div', ['zn-sidebar-footer-safe', 'grid'], {}, [el('div'), help(), settings()])])
    assert.equal(sidebarCommandsSlot(documentOf(older))?.tagName, 'DIV')
  })

  it('is not taken when a Files action fills it, or when there is no footer', () => {
    const withFiles = el('aside', [], {}, [
      el('div', ['grid'], {}, [el('button', [], { 'data-sidebar-type': 'files' }), help(), settings()])
    ])
    assert.equal(sidebarCommandsSlot(documentOf(withFiles)), null)
    assert.equal(sidebarCommandsSlot(documentOf(el('main'))), null)
  })
})
