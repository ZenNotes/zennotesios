/**
 * One source of truth for "is this a phone", split into the two questions
 * that hide inside it:
 *
 * - "Is this DEVICE a phone?" — answered from the physical screen's shorter
 *   side, which rotation can't change. The shell used to answer with
 *   `window.innerWidth < 768` in JS and `@media (max-width: 767px)` in CSS,
 *   both of which a phone crosses the moment it rotates: a 1080x2400 handset
 *   is 411 CSS px in portrait but 914 in landscape, and past 768 the whole
 *   phone layout switched off mid-session — desktop title bar, tab strip,
 *   left-crammed toolbar — and the editor lost its keyboard handling
 *   (issue #12). The cutoff is Android's own sw600dp tablet heuristic: every
 *   iPhone is under 600 CSS pt on its short side (largest: 440), every iPad
 *   is over it (smallest: iPad mini at 744), so nothing sits near the line.
 *
 * - "Does the phone LAYOUT fit right now?" — phones: always (see above).
 *   iPads: the desktop-like layout normally, but a Split View / Slide Over
 *   window can be as narrow as 320pt, where desktop chrome doesn't fit —
 *   those windows get the phone layout, decided from the current window
 *   width with hysteresis so a live resize (Stage Manager, the browser dev
 *   loop) doesn't flicker the whole shell at the boundary.
 *
 * CSS can't express the screen-based half (a media query only ever sees the
 * current viewport), so the decision is made here and published to CSS as a
 * class on <html>, which is also what makes it impossible for the two to
 * disagree.
 */

/** Below this many CSS px on the screen's short side, the device is a phone. */
export const PHONE_DEVICE_BREAKPOINT = 600

/** Tablet windows narrower than this get the phone layout. */
export const PHONE_LAYOUT_BREAKPOINT = 768

/**
 * The tablet window check re-classifies only once the width clears the
 * boundary by this margin, so a resize drag hovering near 768 doesn't
 * remount the shell on every frame.
 */
const LAYOUT_HYSTERESIS = 24

/** Class mirrored onto <html> so mobile.css can gate on the same decision. */
export const PHONE_CLASS = 'zn-phone'

/**
 * Shorter side of the display in CSS px.
 *
 * `screen` is preferred over `innerWidth`/`innerHeight` because the soft
 * keyboard shrinks the inner viewport under KeyboardResize.Native — in
 * landscape that can drop the inner height to ~200px, and a phone must not be
 * reclassified just because someone started typing. Falls back to the inner
 * dimensions where `screen` is unavailable or reports nonsense (0 in some
 * WebView states).
 */
function smallestScreenSide(): number {
  const { screen } = window
  if (screen && screen.width > 0 && screen.height > 0) {
    return Math.min(screen.width, screen.height)
  }
  return Math.min(window.innerWidth, window.innerHeight)
}

/**
 * True on phone hardware, in either orientation. Stable for the life of the
 * session — use this for decisions that must never flip mid-session, like
 * the keyboard resize mode (main.tsx).
 */
export function isPhoneDevice(): boolean {
  return smallestScreenSide() < PHONE_DEVICE_BREAKPOINT
}

// Hysteresis state for the tablet window check. `null` until first asked;
// after that the answer only changes when the width clearly crosses the
// boundary, so callers mid-resize get a stable classification.
let tabletPhoneLayout: boolean | null = null

function tabletWindowWantsPhoneLayout(): boolean {
  // A fullscreen tablet is NEVER a phone, whatever its size: iPad mini is
  // 744pt wide fullscreen-portrait, and a flat 768 cutoff would flip it
  // phone↔desktop on every rotation (the exact failure the screen-based
  // device check exists to prevent). Only windows narrower than the
  // tablet's own portrait width — a real Split View / Slide Over strip —
  // qualify.
  const screenShort = smallestScreenSide()
  const breakpoint = Math.min(PHONE_LAYOUT_BREAKPOINT, screenShort)
  // The exit threshold is capped at the fullscreen width too, or an iPad
  // mini expanded from Slide Over to fullscreen portrait (744pt — inside
  // the naive hysteresis band) could never leave the phone layout.
  const exitAt = Math.min(breakpoint + LAYOUT_HYSTERESIS, screenShort)
  const width = window.innerWidth
  if (tabletPhoneLayout === null) {
    tabletPhoneLayout = width < breakpoint
  } else if (tabletPhoneLayout) {
    if (width >= exitAt) tabletPhoneLayout = false
  } else if (width < breakpoint - LAYOUT_HYSTERESIS) {
    tabletPhoneLayout = true
  }
  return tabletPhoneLayout
}

/** True when the phone layout should be showing right now. */
export function isPhoneViewport(): boolean {
  const mode = getLayoutMode()
  if (mode !== 'auto') return mode === 'phone'
  return isPhoneDevice() || tabletWindowWantsPhoneLayout()
}

// ---------------------------------------------------------------------------
// Layout override (#652). The automatic decision above reads the hardware,
// and the hardware lies for a class of devices: an 8" Android slate at 1.5x
// density is 533 CSS px on its short side and classifies as a phone for good,
// and a tablet in a keyboard case may simply prefer the desktop layout.
// The stored mode wins over the automatic answer; 'auto' is the default and
// removes the key so a fresh install behaves exactly as before.
// ---------------------------------------------------------------------------

export type LayoutMode = 'auto' | 'phone' | 'desktop'

/** localStorage key; read synchronously at boot, before any React mounts. */
export const LAYOUT_MODE_KEY = 'zn:layout-mode'

/** localStorage key for the swipe-gesture assignments (#24); JSON, see
 *  ui-mobile/gestures.ts. */
export const GESTURES_KEY = 'zn:gestures'

export function getLayoutMode(): LayoutMode {
  try {
    const raw = localStorage.getItem(LAYOUT_MODE_KEY)
    return raw === 'phone' || raw === 'desktop' ? raw : 'auto'
  } catch {
    return 'auto'
  }
}

export function setLayoutMode(mode: LayoutMode): void {
  try {
    if (mode === 'auto') localStorage.removeItem(LAYOUT_MODE_KEY)
    else localStorage.setItem(LAYOUT_MODE_KEY, mode)
  } catch {
    // Storage unavailable: the choice applies to this session only.
  }
}


/** Publish the current decision to CSS. Safe to call repeatedly. */
export function syncPhoneClass(): void {
  document.documentElement.classList.toggle(PHONE_CLASS, isPhoneViewport())
}

/**
 * Keep the published class in step with the viewport. On phones the
 * classification never changes; on iPads it flips when a Split View /
 * Stage Manager resize crosses the boundary. `onChange` fires once
 * immediately with the current state, then again on every change — so a
 * caller never needs a separate initial-publication call that could drift.
 * Returns an unsubscribe function.
 */
export function watchPhoneClass(
  onChange?: (isPhone: boolean) => void
): () => void {
  let last = isPhoneViewport()
  syncPhoneClass()
  onChange?.(last)
  const reevaluate = (): void => {
    const next = isPhoneViewport()
    syncPhoneClass()
    if (next !== last) {
      last = next
      onChange?.(next)
    }
  }
  window.addEventListener('resize', reevaluate)
  window.addEventListener('orientationchange', reevaluate)
  return () => {
    window.removeEventListener('resize', reevaluate)
    window.removeEventListener('orientationchange', reevaluate)
  }
}
