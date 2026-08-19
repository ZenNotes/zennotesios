/**
 * Swipeable drawer row (spec 07 gestures, Discord feedback 2026-08-17).
 *
 * - Swipe LEFT reveals action buttons (Archive / Delete for notes) that stay
 *   open until an action is tapped, the row is tapped, or another row swipes.
 * - Swipe RIGHT past the trigger pins/unpins immediately on release — the
 *   accent-tinted pin chip under the row is its own confirmation.
 *
 * Coexistence rules, all load-bearing:
 * - The drawer's own swipe-left-to-close gesture (MobileShell) skips touches
 *   that start inside [data-zn-swipe]; the attribute is set only on rows that
 *   HAVE left actions, so action-less rows (folders) still let a left swipe
 *   close the drawer instead of going dead.
 * - The rows' long-press action sheet uses pointer events with a 12px slop;
 *   CLAIM matches it, so by the time a drag claims the swipe the long-press
 *   timer has already been cancelled — the two never both fire.
 * - Vertical scrolling wins: the gesture only claims the touch once |dx|
 *   beats both |dy| and the slop, and once claimed it calls preventDefault so
 *   the scroller doesn't pan underneath (touch-action: pan-y on the wrapper
 *   makes that contract explicit).
 * - A cancelled or multi-touch gesture reverts — it never commits a pin.
 * - Only one row holds its actions open at a time (module-level closer).
 */
import React, { useEffect, useRef, useState } from 'react'

const ACTION_WIDTH = 72 // px per revealed action button
// Leftward swipes move the row content by only a third of the gesture — the
// action buttons slide in OVER the row's right edge instead, so the note
// title stays readable while the actions are open (Adib, device testing:
// full-width translation made the row "disappear" in the narrow drawer).
const CONTENT_FOLLOW = 1 / 3
const PIN_TRIGGER = 64 // px of right-swipe that commits a pin toggle
// Horizontal movement before the row claims the touch. MUST stay >= the
// 12px long-press slop (useLongPress, MobileDrawer) — a smaller value opens
// a band where the row is mid-swipe while the long-press timer is still
// armed, and the action sheet fires over a displaced row.
const CLAIM = 12

let closeOpenRow: (() => void) | null = null

// True while some row has claimed the current touch. The drawer's edge-swipe
// close tracker (MobileShell) consults this so a pin swipe that gets wound
// back leftward past the close trigger can't slam the drawer shut mid-row-
// gesture — the [data-zn-swipe] carve-out only covers rows with left actions.
let claimActive = false

export function isSwipeRowGestureActive(): boolean {
  return claimActive
}

export interface SwipeAction {
  label: string
  icon: React.ReactNode
  danger?: boolean
  onAction: () => void
}

export function SwipeRow(props: {
  /** Revealed by a left swipe; empty array disables left swipe. */
  leftActions: SwipeAction[]
  /** Fired by a committed right swipe (pin/unpin). */
  onPinSwipe: () => void
  pinned: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const { leftActions, onPinSwipe, pinned, children } = props
  const [dx, setDx] = useState(0)
  const [settling, setSettling] = useState(false)
  const openWidth = leftActions.length * ACTION_WIDTH
  const open = dx === -openWidth && openWidth > 0

  const touch = useRef<{
    x: number
    y: number
    claimed: boolean
    dead: boolean
    fromDx: number
  } | null>(null)
  // Live displacement, updated synchronously by the move handler. The end
  // handler reads THIS, not the `dx` state: React commits touchmove-driven
  // state at continuous priority, so on a fast flick the last rendered `dx`
  // can trail the finger when touchend fires.
  const dxRef = useRef(0)
  const rowRef = useRef<HTMLDivElement | null>(null)

  const settleTo = (target: number): void => {
    const from = dxRef.current
    dxRef.current = target
    // Same-target settles run no transition, so transitionend would never
    // clear the flag — don't set it.
    setSettling(from !== target)
    setDx(target)
  }

  useEffect(() => {
    if (!open) return
    const close = (): void => settleTo(0)
    closeOpenRow?.()
    closeOpenRow = close
    return () => {
      if (closeOpenRow === close) closeOpenRow = null
    }
  }, [open])

  // Native listener because React's onTouchMove is passive — preventDefault
  // there is ignored, and the scroller would pan under a claimed swipe.
  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    const onMove = (e: TouchEvent): void => {
      const t = touch.current
      if (!t || t.dead) return
      if (e.touches.length !== 1) {
        // A second finger means pinch — abandon and revert, never commit.
        t.dead = true
        if (t.claimed) {
          claimActive = false
          settleTo(t.fromDx)
        }
        return
      }
      const cx = e.touches[0]!.clientX
      const cy = e.touches[0]!.clientY
      const mx = cx - t.x
      const my = cy - t.y
      if (!t.claimed) {
        if (Math.abs(my) > Math.abs(mx) && Math.abs(my) > CLAIM) {
          t.dead = true // vertical scroll wins
          return
        }
        // Rows with no left actions have no leftward function — never claim
        // a leftward drag there; it belongs to the drawer's swipe-to-close.
        if (openWidth === 0 && !open && mx < 0) {
          t.dead = true
          return
        }
        // Claim only once horizontal movement beats BOTH the slop and the
        // vertical component — a 45° drag is a scroll, not a swipe.
        if (Math.abs(mx) <= CLAIM || Math.abs(mx) <= Math.abs(my)) return
        t.claimed = true
        claimActive = true
        setSettling(false)
      }
      e.preventDefault()
      let next = t.fromDx + mx
      // Clamp with rubber-banding past the functional range. For rows with
      // no left actions min is 0, so the same clamp also damps leftward
      // movement — no separate special case.
      const min = -openWidth
      const max = PIN_TRIGGER + 24
      if (next < min) next = min + (next - min) / 3
      if (next > max) next = max + (next - max) / 3
      dxRef.current = next
      setDx(next)
    }
    el.addEventListener('touchmove', onMove, { passive: false })
    return () => el.removeEventListener('touchmove', onMove)
    // settleTo closes over stable setters/refs only, so the captured copy
    // staying across renders is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openWidth])

  const onTouchStart = (e: React.TouchEvent): void => {
    if (e.touches.length !== 1) {
      // Second finger landed on this row mid-gesture: abandon and revert.
      const t = touch.current
      touch.current = null
      if (t?.claimed) {
        claimActive = false
        settleTo(t.fromDx)
      }
      return
    }
    if (closeOpenRow && !open) closeOpenRow()
    touch.current = {
      x: e.touches[0]!.clientX,
      y: e.touches[0]!.clientY,
      claimed: false,
      dead: false,
      fromDx: open ? -openWidth : 0
    }
  }

  const onTouchEnd = (): void => {
    const t = touch.current
    touch.current = null
    if (t?.claimed) claimActive = false
    if (!t || t.dead || !t.claimed) return
    const x = dxRef.current
    if (x > PIN_TRIGGER) {
      onPinSwipe()
      settleTo(0)
    } else if (openWidth > 0 && x < -openWidth / 2) {
      settleTo(-openWidth)
    } else {
      settleTo(0)
    }
  }

  const onTouchCancel = (): void => {
    // The system stole the touch (edge swipe, call banner, app switch) —
    // revert to where the gesture started; a cancel must never commit a pin.
    const t = touch.current
    touch.current = null
    if (t?.claimed) {
      claimActive = false
      settleTo(t.fromDx)
    }
  }

  const suppressWhileOpen = (e: React.MouseEvent): void => {
    // A tap on a swiped-open row closes it instead of navigating.
    if (dx !== 0) {
      e.preventDefault()
      e.stopPropagation()
      settleTo(0)
    }
  }

  // The under/over-layers render only while the row is displaced, so resting
  // rows are plain drawer rows. Rightward (pin) swipes move the content 1:1 to
  // uncover the pin chip; leftward swipes move it by CONTENT_FOLLOW while the
  // actions slide in over the right edge.
  const engaged = dx !== 0 || settling || open
  const contentX = dx >= 0 ? dx : dx * CONTENT_FOLLOW
  const actionsX = Math.max(0, openWidth + Math.min(0, dx))
  return (
    <div
      className={`zn-swipe${settling ? ' is-settling' : ''}`}
      // Only rows with left actions opt out of the drawer's swipe-to-close
      // (MobileShell carve-out); action-less rows keep the close gesture.
      data-zn-swipe={leftActions.length > 0 ? '' : undefined}
      ref={rowRef}
    >
      {engaged && (
        <div className="zn-swipe-pin" aria-hidden="true" style={{ opacity: dx > 8 ? 1 : 0 }}>
          <span className={dx > PIN_TRIGGER ? 'is-armed' : ''}>
            {pinned ? 'Unpin' : 'Pin'}
          </span>
        </div>
      )}
      {leftActions.length > 0 && engaged && (
        <div
          className="zn-swipe-actions"
          style={{ width: openWidth, transform: `translateX(${actionsX}px)` }}
        >
          {leftActions.map((a) => (
            <button
              key={a.label}
              type="button"
              className={a.danger ? 'zn-danger' : ''}
              tabIndex={open ? 0 : -1}
              onClick={() => {
                settleTo(0)
                a.onAction()
              }}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
      <div
        className="zn-swipe-content"
        style={{ transform: `translateX(${contentX}px)` }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        onClickCapture={suppressWhileOpen}
        onTransitionEnd={() => setSettling(false)}
      >
        {children}
      </div>
    </div>
  )
}
