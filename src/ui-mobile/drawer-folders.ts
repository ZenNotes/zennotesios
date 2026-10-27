/**
 * The folders the drawer's Notes list leaves out. The Daily, Weekly and
 * Monthly Notes rows above it open those folders directly, so listing them
 * again under Notes showed every periodic note twice: two rows, one folder
 * (uNyanda, Discord 2026-10-27, after the layout fix for
 * ZenNotes/zennotesandroid#17 had shipped). The desktop sidebar draws them
 * once, too: periodic notes get their own Quick Access rows and the folders
 * that only held them leave its tree.
 *
 * A folder that holds nothing but periodic folders (`Journal` around
 * `Journal/Daily`) goes as well, so the list never offers a folder that opens
 * onto nothing. One holding anything else, a note, a file, a database or a
 * folder of its own, keeps its row. Nothing is lost by hiding: everything
 * inside a periodic folder, including notes that are not periodic, is one tap
 * away through its row.
 */
import { dirOf } from './note-order.ts'

export interface DrawerFolderSource {
  readonly folders: readonly { readonly directory: string }[]
  readonly databases: readonly { readonly directory: string }[]
  readonly notes: readonly { readonly folder: string; readonly directory: string }[]
  readonly files?: readonly { readonly directory: string }[]
  readonly dateDirectories: {
    readonly daily: string | null
    readonly weekly: string | null
    readonly monthly: string | null
  }
}

const NONE: ReadonlySet<string> = new Set()

export function hiddenDrawerFolders(browse: DrawerFolderSource): ReadonlySet<string> {
  const { daily, weekly, monthly } = browse.dateDirectories
  const periodic = [daily, weekly, monthly].filter((dir): dir is string => !!dir)
  if (periodic.length === 0) return NONE
  const within = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`)
  const inPeriodic = (path: string): boolean => periodic.some(dir => within(path, dir))

  const spine = new Set<string>()
  for (const dir of periodic) {
    for (let parent = dirOf(dir); parent; parent = dirOf(parent)) spine.add(parent)
  }
  const kept = new Set<string>()
  const keepAround = (path: string): void => {
    if (inPeriodic(path)) return
    for (const dir of spine) if (within(path, dir)) kept.add(dir)
  }
  if (spine.size > 0) {
    for (const note of browse.notes) if (note.folder === 'inbox') keepAround(note.directory)
    for (const file of browse.files ?? []) keepAround(file.directory)
    for (const database of browse.databases) keepAround(database.directory)
    for (const folder of browse.folders) {
      if (!spine.has(folder.directory)) keepAround(folder.directory)
    }
  }

  const hidden = new Set(periodic)
  for (const dir of spine) if (!kept.has(dir)) hidden.add(dir)
  return hidden
}
