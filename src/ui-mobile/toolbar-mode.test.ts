import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { loadMobileModule } from '../../tooling/load-mobile-module.ts'

const { NOTE_TITLE_FIELD, toolbarModeFor, toolbarShows } = await loadMobileModule(['./src/ui-mobile/toolbar-mode'])

const el = (inside: string[], is: string[] = []) => ({
  closest: (selector: string) => (inside.includes(selector) ? {} : null),
  matches: (selector: string) => is.includes(selector)
})

describe('the toolbar above the keyboard', () => {
  it('formats in the editor, on a phone and a tablet', () => {
    assert.equal(toolbarModeFor(el(['.cm-editor']), true), 'format')
    assert.equal(toolbarModeFor(el(['.cm-editor']), false), 'format')
  })

  it('stays off the editor search panel', () => {
    assert.equal(toolbarModeFor(el(['.cm-editor', '.cm-panel']), true), null)
  })

  it('offers the chevron alone in the note title field, on a phone', () => {
    assert.equal(toolbarModeFor(el([], [NOTE_TITLE_FIELD]), true), 'dismiss')
    assert.equal(toolbarModeFor(el([], [NOTE_TITLE_FIELD]), false), null)
  })

  it('is off for any other field', () => {
    assert.equal(toolbarModeFor(el([]), true), null)
    assert.equal(toolbarModeFor(null, true), null)
  })

  it('core still marks the field, and the shell still blurs to dismiss', () => {
    const core = readFileSync(new URL('../../node_modules/@zennotes/app-core/dist/components/EditorPane.js', import.meta.url), 'utf8')
    assert.match(core, /"data-note-title-input": ""/)
    const toolbar = readFileSync(new URL('./EditorToolbar.tsx', import.meta.url), 'utf8')
    assert.match(toolbar, /active\.blur\(\)/)
    assert.match(toolbar, /mode === 'format' && BUTTONS\.map/)
  })
})

describe('the row with a hardware keyboard', () => {
  it('stays for a soft keyboard, phone or iPad, floating or not', () => {
    assert.equal(toolbarShows('format', 336), true)
    assert.equal(toolbarShows('dismiss', 336), true)
    assert.equal(toolbarShows('format', 403), true)
  })

  it('goes for a shortcut bar or no frame, and comes back with the keyboard', () => {
    assert.equal(toolbarShows('format', 55), false)
    assert.equal(toolbarShows('dismiss', 55), false)
    assert.equal(toolbarShows('format', 0), false)
    assert.equal(toolbarShows('format', 336), true)
  })

  it('stays gone with nothing to act on', () => {
    assert.equal(toolbarShows(null, 336), false)
  })

  it('reads the frame each time the keyboard shows, on the way in and when settled', () => {
    const toolbar = readFileSync(new URL('./EditorToolbar.tsx', import.meta.url), 'utf8')
    assert.match(toolbar, /addListener\('keyboardWillShow', \(info\) => \{\s*setKeyboardHeight\(info\.keyboardHeight\)/)
    assert.match(toolbar, /addListener\('keyboardDidShow', \(info\) => setKeyboardHeight\(info\.keyboardHeight\)\)/)
    assert.match(toolbar, /addListener\('keyboardWillHide', \(\) => setKeyboardHeight\(0\)\)/)
  })

  it('leaves the enso on screen for a phone with a hardware keyboard', () => {
    const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8')
    const css = readFileSync(new URL('./mobile.css', import.meta.url), 'utf8')
    assert.match(main, /classList\.toggle\('zn-kb-hardware', !isSoftKeyboardHeight\(height\)\)/)
    assert.match(main, /classList\.remove\('zn-kb-open', 'zn-kb-hardware'\)/)
    assert.match(css, /\.zn-kb-open:not\(\.zn-kb-hardware\) \.zn-mobile-fab,/)
  })
})
