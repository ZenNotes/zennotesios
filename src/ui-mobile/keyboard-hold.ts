/**
 * The clock of the read-open guard (read-open.ts), kept apart from the DOM
 * so node --test covers it. Same file in both phone shells.
 *
 * A note opened to be read arms it. Core then hands the editor focus the way
 * desktop wants it, once or in a short burst of retries
 * (focusEditorNormalMode tries for about a quarter of a second), and every
 * try is refused until the burst has gone quiet. A touch releases it at
 * once: tapping into the text is how the keyboard should come up, and
 * anything else the user taps is a new intent.
 */

/** How long an armed guard waits for core's focus: a note read from a
 *  folder vault can take a few seconds to open. */
export const READ_OPEN_WAIT_MS = 5000
/** How long it keeps refusing after a refused focus or a finished open,
 *  past core's retries. */
export const READ_OPEN_SETTLE_MS = 700

export class KeyboardHold {
  private waitUntil = 0
  private settleUntil = 0
  private readonly now: () => number

  constructor(now: () => number) {
    this.now = now
  }

  /** A note is opening to be read. */
  arm(): void {
    this.waitUntil = this.now() + READ_OPEN_WAIT_MS
    this.settleUntil = 0
  }

  /** The open has finished: core's focus, if any, follows within the settle. */
  opened(): void {
    if (!this.active) return
    this.waitUntil = Math.min(this.waitUntil, this.now() + READ_OPEN_SETTLE_MS)
  }

  /** The user touched the screen. */
  release(): void {
    this.waitUntil = 0
    this.settleUntil = 0
  }

  get active(): boolean {
    const t = this.now()
    return t < this.waitUntil || t < this.settleUntil
  }

  /** An editor focus is about to land: true refuses it. */
  refuse(): boolean {
    if (!this.active) return false
    this.waitUntil = 0
    this.settleUntil = this.now() + READ_OPEN_SETTLE_MS
    return true
  }
}
