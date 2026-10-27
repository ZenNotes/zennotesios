/**
 * The `zennotes://` links the widgets fire (ios/App/ZenWidgets —
 * WidgetTheme.swift's ZenLinks builds them; deep-links.ts runs them):
 *
 *   zennotes://new                     create a note in the Inbox and open it
 *   zennotes://open?path=<enc>         open a note by vault-relative path
 *   zennotes://task?id=<enc>&path=<enc> jump to a task line (VaultTask id)
 *   zennotes://tasks                   the Tasks view
 *   zennotes://home                    the Home dashboard
 *   zennotes://calendar[?date=<day>&add=1]
 *                                      the Calendar sheet, on a day; add=1 puts
 *                                      the cursor in "Add a task for ..."
 *   zennotes://day?date=<day>          that day's daily note, else the Calendar on it
 *   zennotes://week?date=<day>         that day's weekly note, else the Calendar on it
 *
 * A <day> is YYYY-MM-DD, a real calendar date.
 *
 * Values are percent-encoded with only unreserved characters left bare, so
 * `#` (task ids are `path#index`) and `&` in titles survive the trip. The
 * Cloud auth callback (`zennotes://auth?…`) shares the scheme and is not
 * ours — it parses to null here. Pure, so node --test covers it.
 */
export type WidgetLink =
  | { kind: 'new' }
  | { kind: 'open'; path: string }
  | { kind: 'task'; id: string; path: string }
  | { kind: 'tasks' }
  | { kind: 'home' }
  | { kind: 'calendar'; date: string | null; add: boolean }
  | { kind: 'day'; date: string }
  | { kind: 'week'; date: string }

/** Vault-relative, forward-slash, no traversal — the same shape the bridge's
 *  `resolveSafeRel` accepts, checked here so a bad link never throws. */
export function isSafeVaultPath(path: string): boolean {
  if (!path || path.length > 2048) return false
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/** `YYYY-MM-DD` naming a day that exists (no 2026-02-30). */
export function isIsoDay(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

export function parseWidgetLink(raw: string): WidgetLink | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'zennotes:') return null
  const action = (url.hostname || url.pathname.replace(/^\/+/, '')).toLowerCase()
  switch (action) {
    case 'new':
      return { kind: 'new' }
    case 'tasks':
      return { kind: 'tasks' }
    case 'home':
      return { kind: 'home' }
    case 'open': {
      const path = url.searchParams.get('path') ?? ''
      return isSafeVaultPath(path) ? { kind: 'open', path } : null
    }
    case 'task': {
      const id = url.searchParams.get('id') ?? ''
      const hash = id.lastIndexOf('#')
      const path = url.searchParams.get('path') ?? (hash > 0 ? id.slice(0, hash) : '')
      if (!id || !isSafeVaultPath(path)) return null
      return { kind: 'task', id, path }
    }
    case 'calendar': {
      const date = url.searchParams.get('date')
      return {
        kind: 'calendar',
        date: isIsoDay(date) ? date : null,
        add: url.searchParams.get('add') === '1'
      }
    }
    case 'day':
    case 'week': {
      const date = url.searchParams.get('date')
      return isIsoDay(date) ? { kind: action, date } : null
    }
    default:
      return null
  }
}
