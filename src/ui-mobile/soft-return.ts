/**
 * Return on the phone's keyboard reaches the editor as Enter, never as
 * Shift+Enter.
 *
 * iOS sets shiftKey on a soft-keyboard key while the keyboard is shifted for a
 * capital, and with the editor's autocapitalize="sentences" (core's native
 * typing) that is every sentence start: an empty bullet, a fresh line.
 * CodeMirror knows and drops the shift from Return, but only while the visual
 * viewport is under 85% of the page (iosVirtualKeyboardOpen in
 * @codemirror/view). A phone runs KeyboardResize.Native, which shrinks the web
 * view itself, so page and viewport shrink together and CodeMirror takes the
 * keyboard for closed. Return then ran as Shift+Enter, which no binding takes,
 * and landed as a bare line break: Return on an empty bullet left the bullet
 * and opened a line under it instead of ending the list, and Return at any
 * sentence start continued no list, task or quote.
 *
 * The shell knows the soft keyboard is up (main.tsx marks html.zn-kb-open and
 * publishes its height), so it hands CodeMirror the same keydown without the
 * shift and lets the real one go on to type the line break, which CodeMirror
 * reads back as that Enter, exactly as it does for an unshifted Return. A
 * hardware keyboard leaves only its shortcut bar on screen, under the height
 * test, so a real Shift+Return keeps its shift.
 */

/** Shorter than any soft keyboard, taller than a hardware keyboard's bar. */
export const SOFT_KEYBOARD_MIN_HEIGHT = 150

export function isSoftKeyboardHeight(height: number): boolean {
  return height >= SOFT_KEYBOARD_MIN_HEIGHT
}

export interface ReturnKeyEvent {
  key: string
  keyCode: number
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  isTrusted: boolean
}

/** CodeMirror's own rule for dropping the shift, with the shell's answer to
 *  "is the soft keyboard up" in place of the viewport ratio. */
export function dropsReturnShift(
  event: ReturnKeyEvent,
  autocapitalize: string,
  keyboardHeight: number
): boolean {
  return (
    event.isTrusted &&
    event.key === 'Enter' &&
    event.keyCode === 13 &&
    event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !/^(off|none)$/.test(autocapitalize) &&
    isSoftKeyboardHeight(keyboardHeight)
  )
}

function keyboardHeight(): number {
  const html = document.documentElement
  if (!html.classList.contains('zn-kb-open')) return 0
  return Number.parseFloat(html.style.getPropertyValue('--zn-kb-height')) || 0
}

export function installSoftReturn(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const content = target.closest<HTMLElement>('.cm-content')
    if (!content || !dropsReturnShift(event, content.autocapitalize, keyboardHeight())) return
    event.stopImmediatePropagation()
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: event.key,
        code: event.code,
        keyCode: event.keyCode,
        which: event.which,
        bubbles: true,
        cancelable: true,
        composed: true
      })
    )
  }
  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}
