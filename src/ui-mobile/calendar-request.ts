/**
 * Asking MobileShell for the Calendar from outside it: the circle and the
 * ••• sheet ask with no day, the home-screen widget's links with the day it
 * showed (and `add` to put the cursor in "Add a task for ..."). An event, not
 * an import, so deep-links.ts does not pull the shell's components in.
 */
export const SHOW_CALENDAR_EVENT = 'zn:show-calendar'

export interface CalendarRequest {
  /** `YYYY-MM-DD`, or null for the calendar's own choice (the open daily
   *  note's day, else today). */
  date: string | null
  add: boolean
}

export function requestCalendar(request?: CalendarRequest): void {
  window.dispatchEvent(new CustomEvent<CalendarRequest | undefined>(SHOW_CALENDAR_EVENT, { detail: request }))
}

export const CLOSE_CALENDAR_SHEET_EVENT = 'zn:close-calendar-sheet'

/** Put the phone's Calendar sheet away (a widget link is about to show
 *  something else). A tablet's panel beside the note is left as it is. */
export function closeCalendarSheet(): void {
  window.dispatchEvent(new Event(CLOSE_CALENDAR_SHEET_EVENT))
}
