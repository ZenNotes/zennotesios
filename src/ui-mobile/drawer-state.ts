/**
 * Open/closed state for the mobile navigation drawer, shared between the
 * bottom nav, edge-swipe gesture, breadcrumb taps, and the drawer itself.
 */
import { useSyncExternalStore } from 'react'

let drawerOpen = false
const subscribers = new Set<() => void>()

export function setDrawerOpen(open: boolean): void {
  if (drawerOpen === open) return
  drawerOpen = open
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
