/**
 * Which app-level mobile sheet (vault switcher / remote-vault manager) is
 * open, shared module-wide like drawer-state so any surface can summon them:
 * the drawer header, the ••• action sheet, and the injected Settings rows.
 */
import { useSyncExternalStore } from 'react'

export type MobileSheetKind = 'vaults' | 'server'

let current: MobileSheetKind | null = null
const subscribers = new Set<() => void>()

export function openMobileSheet(kind: MobileSheetKind): void {
  if (current === kind) return
  current = kind
  for (const cb of subscribers) cb()
}

export function closeMobileSheet(): void {
  if (current === null) return
  current = null
  for (const cb of subscribers) cb()
}

export function useMobileSheet(): MobileSheetKind | null {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    () => current
  )
}
