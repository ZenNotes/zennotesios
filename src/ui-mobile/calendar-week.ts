/**
 * The date math behind the Tasks calendar's Week scope on a phone
 * (useCalendarWeekMode in MobileShell.tsx): which week shows, and the day a
 * week step lands on. Core draws the month as one flat run of 42
 * `data-cal-day` cells, six weeks from the week that holds the 1st, so a week
 * is seven cells in a row.
 */

/** `YYYY-MM-DD` of a local date. Never toISOString(), which is UTC and names
 *  the next day on an evening west of Greenwich. */
export function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** The local day `days` after `iso` (before it when negative), across month
 *  and year ends. */
export function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  return localIsoDate(new Date(year, month - 1, day + days))
}

export interface CalendarDay {
  iso: string
  selected: boolean
}

/** The cell the shown week is built around: the selected day, else today,
 *  else the grid's second row (its first is often all last month). */
export function weekAnchorIndex(days: readonly CalendarDay[], todayIso: string): number {
  const selected = days.findIndex((day) => day.selected)
  if (selected >= 0) return selected
  const today = days.findIndex((day) => day.iso === todayIso)
  if (today >= 0) return today
  return Math.max(0, Math.min(7, days.length - 1))
}

/** The day a week step from `anchorIso` lands on, and whether the grid on
 *  screen holds it (a step out of the month's six weeks does not). */
export function weekStep(
  gridIsos: readonly string[],
  anchorIso: string,
  direction: 1 | -1
): { day: string; inGrid: boolean } {
  const day = addDaysIso(anchorIso, 7 * direction)
  return { day, inGrid: gridIsos.includes(day) }
}
