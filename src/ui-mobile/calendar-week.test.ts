import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { addDaysIso, localIsoDate, weekAnchorIndex, weekStep, type CalendarDay } from './calendar-week.ts'

/** Core's grid for a month: 42 days from the Monday on or before the 1st. */
function monthGrid(year: number, month: number): string[] {
  const first = new Date(year, month - 1, 1)
  const offset = (first.getDay() - 1 + 7) % 7
  return Array.from({ length: 42 }, (_, i) => localIsoDate(new Date(year, month - 1, 1 - offset + i)))
}

const days = (isos: string[], selected?: string): CalendarDay[] =>
  isos.map((iso) => ({ iso, selected: iso === selected }))

describe('the Tasks calendar Week scope', () => {
  it('counts days locally, across month and year ends', () => {
    assert.equal(addDaysIso('2026-11-01', 7), '2026-11-08')
    assert.equal(addDaysIso('2026-11-30', 7), '2026-12-07')
    assert.equal(addDaysIso('2026-11-01', -7), '2026-10-25')
    assert.equal(addDaysIso('2026-12-29', 7), '2027-01-05')
    assert.equal(addDaysIso('2024-02-26', 7), '2024-03-04')
    assert.equal(localIsoDate(new Date(2026, 10, 1, 23, 30)), '2026-11-01')
  })

  it('builds the week around the selected day, else today, else the second row', () => {
    const grid = monthGrid(2026, 11)
    assert.equal(weekAnchorIndex(days(grid, '2026-11-18'), '2026-11-01'), grid.indexOf('2026-11-18'))
    assert.equal(weekAnchorIndex(days(grid), '2026-11-01'), grid.indexOf('2026-11-01'))
    assert.equal(weekAnchorIndex(days(grid), '2027-05-01'), 7)
  })

  it('steps a week, not a month: Nov 1 goes to Nov 8, and back to Oct 25', () => {
    const grid = monthGrid(2026, 11)
    assert.deepEqual(weekStep(grid, '2026-11-01', 1), { day: '2026-11-08', inGrid: true })
    // November's grid opens on Monday Oct 26, so a week before Sunday Nov 1
    // is October's to draw.
    assert.deepEqual(weekStep(grid, '2026-11-01', -1), { day: '2026-10-25', inGrid: false })
    assert.ok(monthGrid(2026, 10).includes('2026-10-25'))
  })

  it('takes a step off the end of the six weeks into the next month', () => {
    const grid = monthGrid(2026, 11)
    assert.equal(grid.at(-1), '2026-12-06')
    assert.deepEqual(weekStep(grid, '2026-11-30', 1), { day: '2026-12-07', inGrid: false })
    assert.ok(monthGrid(2026, 12).includes('2026-12-07'))
    // A step that stays in the grid's spill-over days is still a tap away.
    assert.deepEqual(weekStep(grid, '2026-11-26', 1), { day: '2026-12-03', inGrid: true })
  })
})

describe('the chevrons in Week mode', () => {
  const shell = readFileSync(new URL('./MobileShell.tsx', import.meta.url), 'utf8')
  const hook = shell.slice(shell.indexOf('function useCalendarWeekMode('), shell.indexOf('const RIGHT_PANEL_SELECTOR'))
  const calendar = readFileSync(
    new URL('../../node_modules/@zennotes/app-core/dist/components/TasksCalendar.js', import.meta.url),
    'utf8'
  )

  it("take core's month step in Week mode and tap the day a week away instead", () => {
    assert.match(shell, /\[data-tasks-toolbar\] button\[title\^='Previous month'\], \[data-tasks-toolbar\] button\[title\^='Next month'\]/)
    assert.match(hook, /if \(scope\(\) !== 'week'\) return/)
    assert.match(hook, /if \(inGrid\) \{\s+\/\/[^\n]*\n\s+e\.preventDefault\(\)\s+e\.stopPropagation\(\)\s+tapDay\(day\)/)
    assert.match(hook, /tapDayWhenDrawn\(day\)/)
    assert.match(hook, /document\.addEventListener\('click', onStep, true\)/)
    assert.match(hook, /document\.removeEventListener\('click', onStep, true\)/)
  })

  it('name the step they take for VoiceOver', () => {
    assert.match(hook, /'Next week' : 'Previous week'/)
  })

  it("rely on core's chevrons stepping a month and a day's tap following it into its month", () => {
    assert.match(calendar, /onClick: \(\) => goToMonth\(-1\), title: "Previous month \(\[\)"/)
    assert.match(calendar, /onClick: \(\) => goToMonth\(1\), title: "Next month \(\]\)"/)
    assert.match(calendar, /"data-cal-day": cellIso, onClick: \(\) => \{\s+setSelectedDate\(cellIso\);\s+if \(isOtherMonth\)\s+setMonthAnchor\(toIsoDateLocal\(firstOfMonth\(cell\)\)\);/)
    assert.match(calendar, /: isSelected\s+\? 'ring-2 ring-inset ring-accent\/60'/)
    assert.match(calendar, /Array\.from\(\{ length: 42 \}/)
  })
})
