/**
 * Open/closed state for the mobile navigation drawer, shared between the
 * FAB dial, edge-swipe gesture, breadcrumb taps, and the drawer itself.
 */
import { useSyncExternalStore } from 'react'
import { Keyboard } from '@capacitor/keyboard'

let drawerOpen = false
const subscribers = new Set<() => void>()

export function setDrawerOpen(open: boolean): void {
  if (drawerOpen === open) return
  drawerOpen = open
  if (open) {
    // The drawer can open over a live editing session (edge swipe or a
    // breadcrumb tap while the keyboard is up) — dismiss the keyboard so
    // it doesn't cover the drawer's lower half.
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    void Keyboard.hide().catch(() => {})
  }
  for (const cb of subscribers) cb()
}

export function isDrawerOpen(): boolean {
  return drawerOpen
}

export function useDrawerOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    () => drawerOpen
  )
}
