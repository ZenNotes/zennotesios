/**
 * The Calendar widget's part of the widget snapshot, and the checkbox taps
 * it hands back. Same file, byte for byte, in both phone shells.
 *
 * App-core's `getCalendarWidgetData` builds the calendar (the Calendar
 * sheet's grid marks and week agenda for the months around today); the
 * shell adds where the vault lives and how far it has read the widget's
 * taps. A tap never waits for the app: the native side logs it, draws the
 * row ticked straight away and, on Android, writes the task's line into the
 * note itself when that line is still exactly what the snapshot said
 * (`raw` swapped for `toggled`, both computed by core, so no native code
 * parses a task). The log stays until the app has applied it and published
 * a snapshot whose `actionsAck` covers it; only then does the native side
 * forget it, so a snapshot computed before the app saw a tap never undoes
 * the tick on screen.
 *
 * Only types and pure helpers live here (node --test covers them); the
 * wiring is in widgets.ts.
 */
import type { CalendarWidgetData } from '@zennotes/app-core/calendar'

export interface WidgetCalendar extends CalendarWidgetData {
  /** Which vault this is (its `zn://` root). A tap logged against another
   *  vault is dropped rather than applied to whatever note shares its path. */
  vaultKey: string
  /** Android only: the open vault's root as a native URI (`file://` or a
   *  SAF `content://` tree) the widget writes a tick into. Null on iPhone,
   *  where the widget cannot reach the vault, and for a remote workspace. */
  vaultRoot: string | null
  /** The newest tap (`at`) the app has applied. */
  actionsAck: number
}

/** One checkbox tap, as the native widget logged it. */
export interface WidgetAction {
  /** ms since epoch; unique within the log (the native side bumps a tie). */
  at: number
  vaultKey: string
  /** VaultTask id (`${sourcePath}#${taskIndex}`). */
  id: string
  path: string
  /** 0-based line of the task in its file. */
  line: number
  /** The task's line unticked, as the snapshot gave it. */
  raw: string
  /** The same line ticked, as core's toggle writes it. */
  toggled: string
  /** The state the tap asked for. */
  checked: boolean
  /** The widget already wrote the line into the note (Android, when the
   *  line on disk still matched); the app only needs to rescan it. */
  written: boolean
}

/** Native data is checked, not trusted: anything malformed is dropped. */
export function parseWidgetActions(input: unknown): WidgetAction[] {
  if (!Array.isArray(input)) return []
  const out: WidgetAction[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const a = item as Record<string, unknown>
    if (
      typeof a.at !== 'number' || !Number.isFinite(a.at) ||
      typeof a.vaultKey !== 'string' ||
      typeof a.id !== 'string' || !a.id ||
      typeof a.path !== 'string' || !a.path ||
      typeof a.line !== 'number' ||
      typeof a.raw !== 'string' ||
      typeof a.toggled !== 'string' ||
      typeof a.checked !== 'boolean'
    ) {
      continue
    }
    out.push({
      at: a.at,
      vaultKey: a.vaultKey,
      id: a.id,
      path: a.path,
      line: a.line,
      raw: a.raw,
      toggled: a.toggled,
      checked: a.checked,
      written: a.written === true
    })
  }
  return out.sort((x, y) => x.at - y.at)
}

/** The line the widget showed before the tap: what core looks the task up by. */
export function seenLine(action: WidgetAction): string {
  return action.checked ? action.raw : action.toggled
}
