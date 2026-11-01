import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

// The ⊕ create sheet runs core commands by id, so a renamed id fails here at
// the next adoption instead of as a dead row on a phone.

const commands = readFileSync(
  new URL('../../node_modules/@zennotes/app-core/dist/lib/commands.js', import.meta.url),
  'utf8'
)
const shell = readFileSync(new URL('./MobileShell.tsx', import.meta.url), 'utf8')
const sheet = shell.slice(shell.indexOf('function CreateSheet('), shell.indexOf('function showCalendar('))

describe('New Kanban in the create sheet (ZenNotes/zennotes#1038)', () => {
  it('core registers New Kanban as a command', () => {
    assert.match(commands, /id: 'database\.new\.kanban',\s+title: 'New Kanban'/)
  })

  it('sits right after New database and runs that command', () => {
    const database = sheet.indexOf("runCommand('database.new')")
    const kanban = sheet.indexOf("runCommand('database.new.kanban')")
    assert.ok(database > 0, 'New database row is missing')
    assert.ok(kanban > database, 'New Kanban must follow New database')
    const between = sheet.slice(database, kanban)
    assert.equal(between.match(/<button/g)?.length, 1, 'no other row sits between them')
    assert.match(sheet.slice(kanban), /^[^]*?New Kanban\s*<\/button>/)
  })
})
