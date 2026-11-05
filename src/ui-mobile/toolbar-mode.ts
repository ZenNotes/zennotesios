/**
 * What the toolbar above the soft keyboard offers for the focused element.
 *
 * New note on a phone lands in core's title field, the breadcrumb's input, so
 * the name is typed there and not in the note. The toolbar only knew the
 * editor, so there was no chevron at all while naming a note: a tap where it
 * usually sits landed on the note, which commits the name and takes the caret
 * into the text, and the keyboard stayed up. Formatting means nothing in that
 * field, so it gets the chevron alone. A tablet's keyboard has its own hide
 * key.
 *
 * A hardware keyboard has no use for any of it: there is no soft keyboard to
 * lower, and its only frame is the short shortcut bar. Kept apart from the DOM
 * so node --test covers it.
 */
import { isSoftKeyboardHeight } from './soft-return'

export type ToolbarMode = 'format' | 'dismiss' | null

export interface FocusedElement {
  closest(selector: string): unknown
  matches(selector: string): boolean
}

export const NOTE_TITLE_FIELD = '[data-note-title-input]'

export function toolbarModeFor(active: FocusedElement | null, phone: boolean): ToolbarMode {
  if (!active) return null
  // The search panel's field lives inside .cm-editor too: while the user types
  // a query, the format row would only cover the panel it belongs to.
  if (active.closest('.cm-editor') && !active.closest('.cm-panel')) return 'format'
  return phone && active.matches(NOTE_TITLE_FIELD) ? 'dismiss' : null
}

/** Whether the row shows, given the height of the keyboard's frame (0 with no
 *  keyboard on screen). */
export function toolbarShows(mode: ToolbarMode, keyboardHeight: number): boolean {
  return mode !== null && isSoftKeyboardHeight(keyboardHeight)
}
