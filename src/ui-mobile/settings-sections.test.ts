import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { HIDDEN_SECTION_CLASS, hideSettingsSectionRows, type SectionList, type SectionRow } from './settings-sections.ts'

class Row implements SectionRow {
  readonly classes = new Set<string>()
  readonly classList = { add: (token: string) => { this.classes.add(token) } }
  readonly textContent: string
  constructor(textContent: string) { this.textContent = textContent }
  get hidden(): boolean { return this.classes.has(HIDDEN_SECTION_CLASS) }
}

/** Core's section list, rebuilt with new rows the way a cleared search rebuilds it. */
class Aside implements SectionList {
  rows: Row[] = []
  constructor() { this.rebuild() }
  rebuild(): void {
    this.rows = ['Appearance', 'Typography', 'Editor', 'Tasks', 'Keymap', 'Vault', 'Cloud', 'Templates', 'MCP', 'CLI', 'About']
      .map((label) => new Row(` ${label} `))
  }
  querySelectorAll(): Iterable<SectionRow> { return this.rows }
  visible(): string[] { return this.rows.filter((row) => !row.hidden).map((row) => row.textContent.trim()) }
}

const PHONE = new Set(['MCP', 'CLI', 'Keymap'])

describe('hideSettingsSectionRows', () => {
  it('hides the desktop-only sections by their label', () => {
    const aside = new Aside()
    hideSettingsSectionRows(aside, PHONE)
    assert.deepEqual(aside.visible(), ['Appearance', 'Typography', 'Editor', 'Tasks', 'Vault', 'Cloud', 'Templates', 'About'])
  })

  it('hides them again after core rebuilds the list (a cleared search)', () => {
    const aside = new Aside()
    hideSettingsSectionRows(aside, PHONE)
    aside.rebuild()
    assert.ok(aside.visible().includes('Keymap'), 'the rebuilt list starts with every row')
    hideSettingsSectionRows(aside, PHONE)
    assert.ok(!aside.visible().some((label) => PHONE.has(label)))
  })

  it('is safe to run on every change', () => {
    const aside = new Aside()
    for (let i = 0; i < 3; i++) hideSettingsSectionRows(aside, PHONE)
    assert.equal(aside.visible().length, 8)
  })

  it('leaves Keymap to a tablet, which hides only MCP and CLI', () => {
    const aside = new Aside()
    hideSettingsSectionRows(aside, new Set(['MCP', 'CLI']))
    assert.ok(aside.visible().includes('Keymap'))
  })
})
