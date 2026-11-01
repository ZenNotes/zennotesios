/**
 * A text field outside the editor stays in sight once the soft keyboard is up.
 *
 * A phone runs KeyboardResize.Native: the web view itself gets shorter, and
 * WebKit, which never learns that a keyboard covers anything, does not scroll
 * a focused field clear of it. A field low in a scrolling page (a Settings
 * folder field such as Task folders or the folder board's root) stayed under
 * the keyboard until the first keystroke, when WebKit reveals the caret. Its
 * folder list, which core places on whichever side of the field has room,
 * opened above it and ran under the keyboard too.
 *
 * Once the keyboard is up, the field's own scroll containers move just far
 * enough for it to sit a margin above the keyboard. Core re-places the folder
 * list on that scroll, so the list shows above or below the field in full.
 * The editor is left alone: editor-keyboard-scroll.ts reveals the caret in a
 * note on its own terms (ZenNotes/zennotes#891), and any field inside
 * .cm-editor (the note, its search panel) is never touched here.
 *
 * It runs when something can have covered the field: the keyboard landing,
 * the web view getting shorter, another field taking the focus with the
 * keyboard up. A finger on the screen cancels the steps still pending and
 * holds the rest, so a page the reader is scrolling stays where they put it.
 */
import { Keyboard } from '@capacitor/keyboard'

/** Room kept between the field and the keyboard (or the top of its page). */
export const FIELD_MARGIN = 12
/** After the keyboard lands: the web view resize follows it by a beat. */
const SETTLE_MS = [150, 400, 800]
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number'])

export interface Span {
  top: number
  bottom: number
}

/** What a focused element looks like to the reveal. */
export interface FieldLike {
  tagName: string
  type?: string
  readOnly?: boolean
  isContentEditable?: boolean
  closest(selector: string): unknown
}

/** A field that raises the soft keyboard, outside the editor. */
export function isRevealableField(el: unknown): el is FieldLike {
  if (!el || typeof (el as FieldLike).closest !== 'function') return false
  const field = el as FieldLike
  if (field.closest('.cm-editor')) return false
  if (field.tagName === 'TEXTAREA') return !field.readOnly
  if (field.tagName === 'INPUT') return !field.readOnly && TEXT_INPUT_TYPES.has((field.type || 'text').toLowerCase())
  return field.isContentEditable === true
}

/**
 * How far a scroll container moves its content up (down when negative) so
 * `field` sits inside `area` with `margin` to spare at both edges; 0 when it
 * already does. A field taller than the room shows its top.
 */
export function revealDelta(field: Span, area: Span, margin = FIELD_MARGIN): number {
  const top = area.top + margin
  const bottom = area.bottom - margin
  if (bottom <= top) return 0
  if (field.bottom - field.top > bottom - top || field.top < top) return field.top - top
  if (field.bottom > bottom) return field.bottom - bottom
  return 0
}

/** Scroll every container around `field`, innermost first, until it is in sight. */
export function revealField(field: HTMLElement): void {
  for (let node = field.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (!/^(auto|scroll|overlay)$/.test(overflowY) || node.scrollHeight <= node.clientHeight) continue
    const box = node.getBoundingClientRect()
    const area = { top: Math.max(box.top, 0), bottom: Math.min(box.bottom, window.innerHeight) }
    const delta = revealDelta(field.getBoundingClientRect(), area)
    if (delta) node.scrollTop += delta
  }
}

export function installFieldKeyboardReveal(): () => void {
  const html = document.documentElement
  let frame = 0
  let timers: number[] = []
  let touching = false
  const stop = (): void => {
    cancelAnimationFrame(frame)
    for (const timer of timers) window.clearTimeout(timer)
    frame = 0
    timers = []
  }
  const reveal = (): void => {
    if (touching || !html.classList.contains('zn-kb-open')) return
    const field = document.activeElement
    if (isRevealableField(field)) revealField(field as HTMLElement)
  }
  const revealNextFrame = (): void => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(reveal)
  }
  const revealSoon = (): void => {
    stop()
    revealNextFrame()
    timers = SETTLE_MS.map((ms) => window.setTimeout(reveal, ms))
  }
  // Only a shorter web view can cover a field that was in sight.
  let height = window.innerHeight
  const onResize = (): void => {
    const shrank = window.innerHeight < height
    height = window.innerHeight
    if (shrank) revealNextFrame()
  }
  const onFocusIn = (event: FocusEvent): void => {
    if (html.classList.contains('zn-kb-open') && isRevealableField(event.target)) revealSoon()
  }
  const onTouchStart = (): void => {
    touching = true
    stop()
  }
  const onTouchEnd = (event: TouchEvent): void => {
    if (!event.touches.length) touching = false
  }
  const passive = { capture: true, passive: true }
  document.addEventListener('touchstart', onTouchStart, passive)
  document.addEventListener('touchend', onTouchEnd, passive)
  document.addEventListener('touchcancel', onTouchEnd, passive)
  document.addEventListener('focusin', onFocusIn, true)
  window.addEventListener('resize', onResize)
  const didShow = Keyboard.addListener('keyboardDidShow', revealSoon)
  return () => {
    stop()
    void didShow.then((handle) => handle.remove()).catch(() => {})
    window.removeEventListener('resize', onResize)
    document.removeEventListener('touchstart', onTouchStart, true)
    document.removeEventListener('touchend', onTouchEnd, true)
    document.removeEventListener('touchcancel', onTouchEnd, true)
    document.removeEventListener('focusin', onFocusIn, true)
  }
}
