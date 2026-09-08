/**
 * Swipe-left → Delete on the Quick Notes list (Adib, device testing
 * 2026-09-08: "I can't delete a quicknote, not seeing gestures").
 *
 * app-core's QuickNotesView (opened from the drawer's Quick Notes row) has no
 * delete affordance of its own — on desktop a quick note is deleted from the
 * editor's note menu once it's open, and the list is keyboard-driven. The
 * drawer's note rows already swipe left for Archive / Delete (SwipeRow), so
 * the phone gets the same gesture here. The rows are app-core's DOM, so it's
 * layered on from outside: a document-level touch tracker over
 * `[data-quick-row]` with SwipeRow's exact feel and coexistence rules —
 * claim only once |dx| beats both the 12px slop and |dy| (vertical scrolling
 * wins), the row content follows the finger by a third while a Delete button
 * slides in over the right edge, release past half the button width settles
 * it open, a touch anywhere else closes it, and a tap on the open row closes
 * it instead of opening the note. Touches in the drawer's left-edge zone are
 * left to the drawer.
 *
 * The button is appended INTO the row (position: relative + overflow hidden,
 * mobile.css) and removed again once the row settles closed, so React only
 * ever sees an extra trailing child while a row is engaged — React never
 * reconciles children it didn't create, and a row unmounting takes the
 * button with it. Deleting mirrors the drawer's trashNote: confirm, then
 * `moveToTrash`; the bridge's rescan drops the row from the list.
 */
import { confirmApp } from '@zennotes/app-core/lib/confirm-requests'
import { useStore } from '@zennotes/app-core/store'

const ROW = '[data-quick-row]'
const ACTIONS_CLASS = 'zn-quick-swipe-actions'
const ENGAGED_CLASS = 'zn-quick-swipe'
const SETTLING_CLASS = 'is-settling'

const ACTION_WIDTH = 72 // px, matches SwipeRow's ACTION_WIDTH
// SwipeRow nudges its content by a third; these rows start their title only
// 16px in (no leading icon on the phone), so a third clipped the first
// letter under the row's overflow — a sixth (12px fully open) stays inside.
const CONTENT_FOLLOW = 1 / 6
// MUST stay >= MobileShell's long-press slop (12px) for the same reason as
// SwipeRow's CLAIM, even though quick rows carry no long-press today.
const CLAIM = 12
// MobileShell's drawer-open edge swipe zone; a touch starting there is the
// drawer's, not the row's.
const EDGE = 28
const SETTLE_MS = 200 // > the 180ms CSS transition, so cleanup runs after it

const TRASH_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  // Same glyph as the shell's ••• sheet and the drawer's Delete action.
  '<path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6"/></svg>'

interface Track {
  row: HTMLElement
  x: number
  y: number
  claimed: boolean
  dead: boolean
  fromDx: number
}

/** Current displacement per row (0 when at rest). */
const position = new WeakMap<HTMLElement, number>()
let openRow: HTMLElement | null = null
let track: Track | null = null
let live = 0

function dxOf(row: HTMLElement): number {
  return position.get(row) ?? 0
}

function contentOf(row: HTMLElement): HTMLElement[] {
  return Array.from(row.children).filter(
    (c): c is HTMLElement => c instanceof HTMLElement && !c.classList.contains(ACTIONS_CLASS)
  )
}

function actionsOf(row: HTMLElement): HTMLElement {
  const existing = row.querySelector<HTMLElement>(`:scope > .${ACTIONS_CLASS}`)
  if (existing) return existing
  const el = document.createElement('div')
  el.className = ACTIONS_CLASS
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'zn-danger'
  button.innerHTML = `${TRASH_SVG}Delete`
  button.addEventListener('click', (e) => {
    // The row's own onClick would open the note.
    e.preventDefault()
    e.stopPropagation()
    const path = row.dataset.quickRow
    settle(row, 0)
    if (path) void deleteQuickNote(path)
  })
  el.appendChild(button)
  row.appendChild(el)
  return el
}

function paint(row: HTMLElement, dx: number, settling: boolean): void {
  position.set(row, dx)
  row.classList.add(ENGAGED_CLASS)
  row.classList.toggle(SETTLING_CLASS, settling)
  const contentX = dx * CONTENT_FOLLOW
  for (const child of contentOf(row)) child.style.transform = `translateX(${contentX}px)`
  actionsOf(row).style.transform = `translateX(${Math.max(0, ACTION_WIDTH + dx)}px)`
}

function rest(row: HTMLElement): void {
  position.delete(row)
  row.classList.remove(ENGAGED_CLASS, SETTLING_CLASS)
  for (const child of contentOf(row)) child.style.removeProperty('transform')
  row.querySelector(`:scope > .${ACTIONS_CLASS}`)?.remove()
}

function settle(row: HTMLElement, target: number): void {
  if (!row.isConnected) {
    if (openRow === row) openRow = null
    return
  }
  paint(row, target, true)
  if (target === 0) {
    if (openRow === row) openRow = null
    window.setTimeout(() => {
      // Only tidy up if nothing re-engaged the row meanwhile.
      if (dxOf(row) === 0 && !(track?.row === row && track.claimed)) rest(row)
    }, SETTLE_MS)
  } else {
    if (openRow && openRow !== row) settle(openRow, 0)
    openRow = row
  }
}

async function deleteQuickNote(path: string): Promise<void> {
  const note = useStore.getState().notes.find((n) => n.path === path)
  const ok = await confirmApp({
    title: `Delete "${note?.title ?? path}"?`,
    description: 'It will move to the trash.',
    confirmLabel: 'Delete',
    danger: true
  })
  if (ok) await window.zen.moveToTrash(path)
}

function onTouchStart(e: TouchEvent): void {
  if (e.touches.length !== 1) {
    // A second finger mid-gesture: abandon and revert, never leave a row
    // half-open.
    const t = track
    track = null
    if (t?.claimed) settle(t.row, t.fromDx)
    return
  }
  const touch = e.touches[0]!
  const target = e.target as HTMLElement | null
  const row = target?.closest?.(ROW)
  const rowEl = row instanceof HTMLElement ? row : null
  // A touch anywhere but the open row closes it (the open row's own tap is
  // handled at click time so the note doesn't open underneath).
  if (openRow && rowEl !== openRow) settle(openRow, 0)
  track = null
  if (!rowEl || touch.clientX <= EDGE) return
  if (target?.closest?.(`.${ACTIONS_CLASS}`)) return
  track = {
    row: rowEl,
    x: touch.clientX,
    y: touch.clientY,
    claimed: false,
    dead: false,
    fromDx: rowEl === openRow ? -ACTION_WIDTH : 0
  }
}

function onTouchMove(e: TouchEvent): void {
  const t = track
  if (!t || t.dead) return
  if (e.touches.length !== 1) {
    t.dead = true
    if (t.claimed) settle(t.row, t.fromDx)
    return
  }
  const touch = e.touches[0]!
  const mx = touch.clientX - t.x
  const my = touch.clientY - t.y
  if (!t.claimed) {
    if (Math.abs(my) > Math.abs(mx) && Math.abs(my) > CLAIM) {
      t.dead = true // vertical scroll wins
      return
    }
    // A rightward drag on a closed row has nothing to reveal.
    if (mx > 0 && t.fromDx === 0) {
      t.dead = true
      return
    }
    if (Math.abs(mx) <= CLAIM || Math.abs(mx) <= Math.abs(my)) return
    if (!t.row.isConnected) {
      t.dead = true
      return
    }
    t.claimed = true
  }
  e.preventDefault()
  let next = t.fromDx + mx
  if (next > 0) next = 0
  // Rubber-band past the button.
  if (next < -ACTION_WIDTH) next = -ACTION_WIDTH + (next + ACTION_WIDTH) / 3
  live = next
  paint(t.row, next, false)
}

function onTouchEnd(): void {
  const t = track
  track = null
  if (!t || t.dead || !t.claimed) return
  settle(t.row, live < -ACTION_WIDTH / 2 ? -ACTION_WIDTH : 0)
}

function onTouchCancel(): void {
  // The system stole the touch (edge swipe, call banner, app switch).
  const t = track
  track = null
  if (t?.claimed) settle(t.row, t.fromDx)
}

function onClickCapture(e: MouseEvent): void {
  const row = openRow
  if (!row) return
  const target = e.target as HTMLElement | null
  if (!target || !row.contains(target)) return
  if (target.closest(`.${ACTIONS_CLASS}`)) return
  // Tapping a swiped-open row closes it instead of opening the note.
  e.preventDefault()
  e.stopPropagation()
  settle(row, 0)
}

/** Install the gesture document-wide; returns the uninstaller. */
export function installQuickNoteSwipe(): () => void {
  // Capture phase so the tracker sees the touch before app-core's React
  // handlers; touchmove is non-passive because a claimed swipe must stop
  // the list from scrolling under it.
  document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true })
  document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
  document.addEventListener('touchend', onTouchEnd, { passive: true, capture: true })
  document.addEventListener('touchcancel', onTouchCancel, { passive: true, capture: true })
  document.addEventListener('click', onClickCapture, { capture: true })
  return () => {
    document.removeEventListener('touchstart', onTouchStart, { capture: true } as never)
    document.removeEventListener('touchmove', onTouchMove, { capture: true } as never)
    document.removeEventListener('touchend', onTouchEnd, { capture: true } as never)
    document.removeEventListener('touchcancel', onTouchCancel, { capture: true } as never)
    document.removeEventListener('click', onClickCapture, { capture: true } as never)
    if (openRow) rest(openRow)
    openRow = null
    track = null
  }
}
