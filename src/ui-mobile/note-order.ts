/**
 * The drawer's note ordering, shared with the editor's swipe-between-notes
 * gesture so a horizontal flick moves through EXACTLY the sequence the Browse
 * drawer shows for that folder — pinned notes first, then the user's
 * `noteSortOrder`. Two orderings would make the gesture feel random.
 */
import type { useStore, NoteSortOrder } from '@zennotes/app-core/store'
import { naturalCompare } from '@zennotes/app-core/lib/natural-sort'
import { parentDirOf } from '@zennotes/app-core/lib/manual-order'
import { notePathWithinFolder } from '@zennotes/app-core/lib/vault-layout'
import { isFormDirName } from '@zennotes/shared-domain/databases'

// Re-exported under the drawer's historical name — app-core's parentDirOf is
// the same helper its store uses for sibling grouping, so the two can't drift.
export { parentDirOf as dirOf }

type SortableNote = { title: string; updatedAt: number; createdAt: number }

/** Mirrors desktop's shared `noteSortOrder` pref. 'none'/'manual' (a desktop
 *  drag order the drawer can't reproduce) fall back to most-recently-edited. */
export function noteComparator(
  order: NoteSortOrder
): (a: SortableNote, b: SortableNote) => number {
  switch (order) {
    case 'name-asc':
      return (a, b) => naturalCompare(a.title, b.title)
    case 'name-desc':
      return (a, b) => naturalCompare(b.title, a.title)
    case 'updated-asc':
      return (a, b) => a.updatedAt - b.updatedAt
    case 'created-desc':
      return (a, b) => b.createdAt - a.createdAt
    case 'created-asc':
      return (a, b) => a.createdAt - b.createdAt
    default:
      return (a, b) => b.updatedAt - a.updatedAt
  }
}

/** Stable-partition pinned rows to the front, preserving sort order within
 *  each half — the drawer's display order. */
export function pinnedFirst<T>(rows: T[], isPinned: (row: T) => boolean): T[] {
  const pinned: T[] = []
  const rest: T[] = []
  for (const row of rows) (isPinned(row) ? pinned : rest).push(row)
  return [...pinned, ...rest]
}

type StoreState = ReturnType<typeof useStore.getState>

/**
 * The drawer-visible note sequence for the folder containing `notePath`,
 * or null when the note isn't in the primary notes area (archive, trash,
 * and virtual tabs have no "siblings" to flick through).
 */
export function siblingNotesInDrawerOrder(
  state: StoreState,
  notePath: string,
  pinnedNotes: readonly string[]
): Array<{ path: string }> | null {
  const active = state.notes.find((n) => n.path === notePath)
  if (!active || active.folder !== 'inbox') return null
  const dir = parentDirOf(notePathWithinFolder(active.path, 'inbox', state.vaultSettings))
  // The drawer never lists notes living inside a `.base` database dir (it
  // shows one database row instead, MobileDrawer's isFormDirName filter) —
  // there is no drawer order to mirror, so the gesture stays out of it too.
  if (isFormDirName(dir.split('/').pop() ?? '')) return null
  const rows = state.notes
    .filter(
      (n) =>
        n.folder === 'inbox' &&
        parentDirOf(notePathWithinFolder(n.path, 'inbox', state.vaultSettings)) === dir
    )
    .sort(noteComparator(state.noteSortOrder))
  const pinned = new Set(pinnedNotes)
  return pinnedFirst(rows, (n) => pinned.has(n.path))
}
