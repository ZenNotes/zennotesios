/**
 * How a Browse drawer row opens what it lists: to be read, keyboard down.
 *
 * The drawer's note, database and file rows (pinned notes among them) opened
 * through a bare `openNote`, outside the read-open guard (read-open.ts), so a
 * note picked there came up with the soft keyboard over half of it and the
 * caret parked before the raw `# Title`, while the same note opened from
 * Home, a list, a link or a search pick was left to read. The hold has to be
 * armed when the row is tapped, not when the note opens: the drawer closes
 * first and the note opens a beat later (DRAWER_CLOSE_MS), and the editor
 * can take the focus in between. Rows that create a note (New note here)
 * keep going through the drawer's plain `go`, so they still focus.
 */

/** The beat between the drawer closing and the row's note opening. */
export const DRAWER_CLOSE_MS = 30

export interface DrawerOpenSteps {
  /** Close the drawer. */
  close: () => void
  /** Wait out the close. */
  wait: (ms: number) => Promise<void>
  /** read-open.ts's `openToRead`: arms the hold, runs the open, settles it. */
  openToRead: <T>(open: () => Promise<T>) => Promise<T>
}

/** Close the drawer and open a row's note to be read, under the hold the
 *  whole way through. */
export function openDrawerRowToRead<T>(open: () => Promise<T>, steps: DrawerOpenSteps): Promise<T> {
  return steps.openToRead(async () => {
    steps.close()
    await steps.wait(DRAWER_CLOSE_MS)
    return open()
  })
}
