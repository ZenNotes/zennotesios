import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  placeVaultSettingsIsland,
  vaultRowActionGroup,
  vaultSettingsAccessForLayout
} from './vault-settings-access.ts'

describe('vaultSettingsAccessForLayout', () => {
  it('keeps the full quick-switch controls in the phone settings layout', () => {
    assert.equal(vaultSettingsAccessForLayout(true), 'quick-switch')
  })

  it('keeps the vault manager reachable in the iPad settings layout', () => {
    assert.equal(vaultSettingsAccessForLayout(false), 'manage-button')
  })
})

// The tests run under plain node, so the row is a small stand-in for the DOM
// that keeps the rule that broke the island: insertBefore throws unless the
// reference node is a direct child.
class FakeElement {
  readonly tagName: string
  readonly label: string
  parentElement: FakeElement | null = null
  private kids: FakeElement[] = []

  constructor(tagName: string, label: string, kids: FakeElement[] = []) {
    this.tagName = tagName.toUpperCase()
    this.label = label
    for (const kid of kids) this.appendChild(kid)
  }

  get children(): FakeElement[] {
    return [...this.kids]
  }

  querySelector(selector: string): FakeElement | null {
    assert.equal(selector, 'button')
    for (const kid of this.kids) {
      if (kid.tagName === 'BUTTON') return kid
      const found = kid.querySelector(selector)
      if (found) return found
    }
    return null
  }

  appendChild(node: FakeElement): FakeElement {
    return this.insertBefore(node, null)
  }

  insertBefore(node: FakeElement, ref: FakeElement | null): FakeElement {
    if (ref && ref.parentElement !== this) {
      throw new Error(
        'NotFoundError: The node before which the new node is to be inserted is not a child of this node.'
      )
    }
    node.parentElement?.removeChild(node)
    const at = ref ? this.kids.indexOf(ref) : this.kids.length
    this.kids.splice(at, 0, node)
    node.parentElement = this
    return node
  }

  removeChild(node: FakeElement): void {
    this.kids = this.kids.filter((kid) => kid !== node)
    node.parentElement = null
  }
}

const el = (tag: string, label: string, kids: FakeElement[] = []): FakeElement =>
  new FakeElement(tag, label, kids)
const labels = (node: FakeElement): string[] => node.children.map((kid) => kid.label)
const place = (row: FakeElement, island: FakeElement, phone: boolean): void =>
  placeVaultSettingsIsland(
    row as unknown as Element,
    island as unknown as Element,
    vaultSettingsAccessForLayout(phone)
  )

// SettingsModal's Vault Location row since core 2.58.0 (#871): the label,
// then ONE wrapping group that holds the buttons.
const coreRow = (buttons: string[]): FakeElement =>
  el('div', 'row', [
    el('div', 'label', [el('div', 'title'), el('div', 'path')]),
    el(
      'div',
      'actions',
      buttons.map((name) => el('button', name))
    )
  ])

// The same row before 2.58.0: the buttons sat bare in the row.
const bareRow = (buttons: string[]): FakeElement =>
  el('div', 'row', [el('div', 'label'), ...buttons.map((name) => el('button', name))])

const phoneIsland = (): FakeElement =>
  el('div', 'island', [el('button', 'My Vault'), el('div', 'btns', [el('button', 'New Vault…')])])

describe('placeVaultSettingsIsland on the phone', () => {
  it('mounts between the label and the wrapped button group', () => {
    const row = coreRow(['Change…'])
    const island = phoneIsland()
    place(row, island, true)
    assert.deepEqual(labels(row), ['label', 'island', 'actions'])
  })

  it('mounts the same way in a remote workspace, with four buttons', () => {
    const row = coreRow([
      'Change Remote Vault…',
      'Return to Local Vault',
      'Open Local Vault…',
      'Quick Connect…'
    ])
    const island = phoneIsland()
    place(row, island, true)
    assert.deepEqual(labels(row), ['label', 'island', 'actions'])
  })

  it('still mounts before bare buttons', () => {
    const row = bareRow(['Change…'])
    const island = phoneIsland()
    place(row, island, true)
    assert.deepEqual(labels(row), ['label', 'island', 'Change…'])
  })

  it('appends when the row has no buttons at all', () => {
    const row = el('div', 'row', [el('div', 'label')])
    const island = phoneIsland()
    place(row, island, true)
    assert.deepEqual(labels(row), ['label', 'island'])
  })
})

describe('placeVaultSettingsIsland on a tablet', () => {
  it('joins the button group so Manage… sits beside Change…', () => {
    const row = coreRow(['Change…'])
    const island = el('div', 'manage', [el('button', 'Manage…')])
    place(row, island, false)
    assert.deepEqual(labels(row), ['label', 'actions'])
    assert.deepEqual(labels(row.children[1]), ['Change…', 'manage'])
  })

  it('appends to the row itself when the buttons are bare', () => {
    const row = bareRow(['Change…'])
    const island = el('div', 'manage', [el('button', 'Manage…')])
    place(row, island, false)
    assert.deepEqual(labels(row), ['label', 'Change…', 'manage'])
  })
})

describe('vaultRowActionGroup', () => {
  it("never mistakes the island's own buttons for the row's", () => {
    const row = coreRow(['Change…'])
    const island = phoneIsland()
    row.insertBefore(island, row.children[1])
    const group = vaultRowActionGroup(row as unknown as Element, island as unknown as Element)
    assert.equal((group as unknown as FakeElement | null)?.label, 'actions')
  })
})
