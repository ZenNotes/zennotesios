/**
 * What counts as a tap on an editor link.
 *
 * Links in the editor follow on the touch's release, once it is plainly a tap: a
 * follow on touchstart opened the note under any scroll that began on a link, and
 * its preventDefault stopped that scroll. A touch that moved, was held, or lost out
 * to a scroll is left alone. Kept apart from the DOM so node --test covers it.
 */

/** The same slop and hold as the note rows' long press (note-row-gestures.ts). */
export const LINK_TAP_SLOP = 10
export const LINK_TAP_MAX_MS = 450

export interface TouchPoint {
  x: number
  y: number
  /** Event.timeStamp, in ms. */
  at: number
}

export function isLinkTap(start: TouchPoint, end: TouchPoint): boolean {
  return (
    Math.abs(end.x - start.x) <= LINK_TAP_SLOP &&
    Math.abs(end.y - start.y) <= LINK_TAP_SLOP &&
    end.at - start.at < LINK_TAP_MAX_MS
  )
}

/** A rendered wikilink in the note, and the same in a table cell, which draws its
 *  links itself. */
export const EDITOR_LINK = '.cm-wikilink'
export const TABLE_CELL_LINK = '.cm-table-cell[data-rendered="true"] a.wikilink'

export interface LinkElement {
  closest(selector: string): { dataset: DOMStringMap } | null
}

/** The note a touch on `el` would follow to, if it is on a link. */
export function linkTargetAt(el: LinkElement | null | undefined): string | undefined {
  if (typeof el?.closest !== 'function') return undefined
  const link = el.closest(EDITOR_LINK)
  if (link) return link.dataset.target
  return el.closest(TABLE_CELL_LINK)?.dataset.wikilink
}
