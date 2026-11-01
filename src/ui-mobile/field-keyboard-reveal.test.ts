import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { loadMobileModule } from '../../tooling/load-mobile-module.ts'

type Listener = (...args: any[]) => void

function define(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
}

/**
 * The real module over a scripted page: a Settings page that scrolls, with a
 * field 691 px down an 874 px screen, as Task folders sits after a scroll.
 * Frames, timers and the keyboard move only when a test says so.
 */
async function setup() {
  const frames = new Map<number, Listener>()
  const timers = new Map<number, Listener>()
  const windowListeners = new Map<string, Listener>()
  const documentListeners = new Map<string, Listener>()
  const keyboard = new Map<string, Listener>()
  const viewport = { height: 874 }
  const html = { open: false, classList: { contains: (name: string) => name === 'zn-kb-open' && html.open } }
  const body = {}
  let ids = 0
  const page = {
    parentElement: body,
    overflowY: 'auto',
    scrollTop: 0,
    scrollHeight: 2324,
    get clientHeight() { return viewport.height - 214 },
    getBoundingClientRect: () => ({ top: 180, bottom: viewport.height })
  }
  const makeField = (top: number, inEditor = false, tagName = 'INPUT', type = 'text') => ({
    tagName,
    type,
    parentElement: page,
    closest: (selector: string) => (inEditor && selector === '.cm-editor' ? {} : null),
    getBoundingClientRect: () => ({ top: top - page.scrollTop, bottom: top + 34 - page.scrollTop })
  })
  const doc = {
    body,
    documentElement: html,
    activeElement: null as unknown,
    addEventListener: (type: string, run: Listener) => { documentListeners.set(type, run) },
    removeEventListener: (type: string, run: Listener) => { if (documentListeners.get(type) === run) documentListeners.delete(type) }
  }
  define('requestAnimationFrame', (run: Listener) => { frames.set(++ids, run); return ids })
  define('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  define('getComputedStyle', (node: { overflowY?: string }) => ({ overflowY: node.overflowY ?? 'visible' }))
  define('window', {
    get innerHeight() { return viewport.height },
    setTimeout: (run: Listener) => { timers.set(++ids, run); return ids },
    clearTimeout: (id: number) => { timers.delete(id) },
    addEventListener: (type: string, run: Listener) => { windowListeners.set(type, run) },
    removeEventListener: (type: string, run: Listener) => { if (windowListeners.get(type) === run) windowListeners.delete(type) }
  })
  define('document', doc)
  const reveal = await loadMobileModule('./src/ui-mobile/field-keyboard-reveal.ts', {
    '@capacitor/keyboard': {
      Keyboard: {
        addListener: (event: string, run: Listener) => {
          keyboard.set(event, run)
          return Promise.resolve({ remove: () => { keyboard.delete(event) } })
        }
      }
    }
  })
  const uninstall: () => void = reveal.installFieldKeyboardReveal()
  return {
    page,
    makeField,
    windowListeners,
    documentListeners,
    keyboardListeners: keyboard,
    uninstall,
    focus(field: unknown) {
      doc.activeElement = field
      documentListeners.get('focusin')?.({ target: field })
    },
    /** keyboardWillShow, then didShow; the web view shrinks a beat later. */
    keyboardUp() { html.open = true; keyboard.get('keyboardDidShow')?.() },
    resize(height: number) { viewport.height = height; windowListeners.get('resize')?.() },
    frame() { const due = [...frames.values()]; frames.clear(); for (const run of due) run() },
    timers() { const due = [...timers.values()]; timers.clear(); for (const run of due) run() },
    touchStart() { documentListeners.get('touchstart')?.({ touches: [{}] }) },
    touchEnd() { documentListeners.get('touchend')?.({ touches: [] }) }
  }
}

describe('a field outside the editor and the soft keyboard', () => {
  it('lifts the field a margin above the keyboard once the web view shrinks', async () => {
    const s = await setup()
    const field = s.makeField(691)
    s.focus(field)
    s.keyboardUp()
    s.frame()
    assert.equal(s.page.scrollTop, 0, 'the web view has not shrunk yet, so nothing covers the field')
    s.resize(573)
    s.frame()
    assert.equal(s.page.scrollTop, 725 - (573 - 12))
    assert.deepEqual(field.getBoundingClientRect(), { top: 527, bottom: 561 })
    s.timers()
    s.frame()
    assert.equal(s.page.scrollTop, 164, 'the settle steps find it in sight and leave it')
    s.uninstall()
  })

  it('settles a field the keyboard landing covers even when no resize follows', async () => {
    const s = await setup()
    s.resize(573)
    const field = s.makeField(600)
    s.focus(field)
    s.keyboardUp()
    s.frame()
    assert.equal(s.page.scrollTop, 634 - 561)
    s.uninstall()
  })

  it('never moves the note: the editor reveals its own caret (#891)', async () => {
    const s = await setup()
    s.focus(s.makeField(691, true, 'DIV'))
    s.keyboardUp()
    s.resize(573)
    s.frame()
    s.timers()
    assert.equal(s.page.scrollTop, 0)
    s.uninstall()
  })

  it('does nothing with the keyboard down, such as on a rotation', async () => {
    const s = await setup()
    s.focus(s.makeField(691))
    s.resize(573)
    s.frame()
    assert.equal(s.page.scrollTop, 0)
    s.uninstall()
  })

  it('leaves the page to a finger that is scrolling it', async () => {
    const s = await setup()
    s.focus(s.makeField(691))
    s.keyboardUp()
    s.touchStart()
    s.resize(573)
    s.frame()
    s.timers()
    assert.equal(s.page.scrollTop, 0, 'not under the finger, and the pending steps are dropped')
    s.touchEnd()
    s.frame()
    s.timers()
    assert.equal(s.page.scrollTop, 0, 'nor once it lifts')
    s.uninstall()
  })

  it('reveals the next field focused while the keyboard stays up', async () => {
    const s = await setup()
    s.focus(s.makeField(300))
    s.keyboardUp()
    s.resize(573)
    s.frame()
    assert.equal(s.page.scrollTop, 0)
    s.focus(s.makeField(896))
    s.frame()
    assert.equal(s.page.scrollTop, 930 - 561)
    s.uninstall()
  })

  it('uninstalling removes every listener', async () => {
    const s = await setup()
    s.uninstall()
    await Promise.resolve()
    assert.equal(s.windowListeners.size, 0)
    assert.equal(s.documentListeners.size, 0)
    assert.equal(s.keyboardListeners.size, 0)
  })
})

describe('which fields and how far', async () => {
  const { isRevealableField, revealDelta, FIELD_MARGIN } = await loadMobileModule(
    './src/ui-mobile/field-keyboard-reveal.ts',
    { '@capacitor/keyboard': { Keyboard: {} } }
  )
  const el = (tagName: string, extra: Record<string, unknown> = {}, inEditor = false) => ({
    tagName,
    closest: (selector: string) => (inEditor && selector === '.cm-editor' ? {} : null),
    ...extra
  })

  it('takes text fields, text areas and editable text outside the editor', () => {
    assert.equal(isRevealableField(el('INPUT', { type: 'text' })), true)
    assert.equal(isRevealableField(el('INPUT', { type: 'search' })), true)
    assert.equal(isRevealableField(el('TEXTAREA')), true)
    assert.equal(isRevealableField(el('DIV', { isContentEditable: true })), true)
  })

  it('leaves the editor, controls that raise no keyboard, and read-only fields', () => {
    assert.equal(isRevealableField(el('DIV', { isContentEditable: true }, true)), false)
    assert.equal(isRevealableField(el('INPUT', { type: 'text' }, true)), false, "the note's search panel")
    assert.equal(isRevealableField(el('INPUT', { type: 'checkbox' })), false)
    assert.equal(isRevealableField(el('INPUT', { type: 'text', readOnly: true })), false)
    assert.equal(isRevealableField(el('BUTTON')), false)
    assert.equal(isRevealableField(null), false)
  })

  it('moves only as far as it must', () => {
    const area = { top: 180, bottom: 573 }
    assert.equal(revealDelta({ top: 300, bottom: 334 }, area), 0)
    assert.equal(revealDelta({ top: 691, bottom: 725 }, area), 725 - 573 + FIELD_MARGIN)
    assert.equal(revealDelta({ top: 100, bottom: 134 }, area), 100 - 180 - FIELD_MARGIN)
    assert.equal(revealDelta({ top: 400, bottom: 900 }, area), 400 - 180 - FIELD_MARGIN, 'a field taller than the room shows its top')
  })
})

describe('where it runs', () => {
  it('on a phone, beside the Return fix, where Native resize hides the keyboard', () => {
    const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8')
    assert.match(main, /mode: isPhoneDevice\(\) \? KeyboardResize\.Native : KeyboardResize\.None/)
    assert.match(main, /if \(isPhoneDevice\(\)\) installFieldKeyboardReveal\(\)/)
  })

  it("and core's folder list follows the field it scrolls", () => {
    const picker = readFileSync(
      new URL('../../node_modules/@zennotes/app-core/dist/components/FolderPickerInput.js', import.meta.url),
      'utf8'
    )
    assert.match(picker, /window\.addEventListener\('scroll', update, true\)/)
    assert.match(picker, /setRect\(dropdownRectForElement\(el, \{ estHeight: rowCount \* ROW_HEIGHT \+ 8 \}\)\)/)
  })
})
