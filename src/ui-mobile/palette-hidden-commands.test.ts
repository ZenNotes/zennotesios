import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const shell = readFileSync(new URL('./MobileShell.tsx', import.meta.url), 'utf8')
const commands = readFileSync(new URL('../../node_modules/@zennotes/app-core/dist/lib/commands.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('./mobile.css', import.meta.url), 'utf8')
const phoneList = shell.slice(shell.indexOf('const PHONE_LAYOUT_HIDDEN_COMMAND_TITLES = ['), shell.indexOf('/** Hidden on phone HARDWARE'))

const TAB_AND_CHROME = [
  'Close Tab', 'Next Tab', 'Previous Tab', 'Pin Tab', 'Unpin Tab', 'Close Other Tabs in Pane',
  'Close Tabs to the Right', 'Open Active Tab Menu', 'Disable Tabs', 'Enable Tabs',
  'Light Sidebar', 'Dark Sidebar', 'Focus Editor',
  'Enable Auto-Reveal Active Note', 'Disable Auto-Reveal Active Note'
]

describe('the palette in the phone layout', () => {
  it('hides the tab and sidebar commands, each under the title core gives it', () => {
    for (const title of TAB_AND_CHROME) {
      assert.ok(phoneList.includes(`'${title}'`), `${title} is on the phone list`)
      assert.ok(commands.includes(`'${title}'`) || commands.includes(`"${title}"`), `core still titles a command ${title}`)
    }
  })

  it('sweeps command rows only, so a note title never hides in another palette', () => {
    assert.match(shell, /querySelectorAll<HTMLElement>\('button\[data-cmd-idx\]'\)/)
  })

  it('leaves the chip with a command\'s shortcut hidden by CSS', () => {
    assert.match(css, /\.zn-phone \.z-palette span\[class\*='bg-paper-200\/80'\]/)
    const palette = readFileSync(new URL('../../node_modules/@zennotes/app-core/dist/components/CommandPalette.js', import.meta.url), 'utf8')
    assert.match(palette, /cmd\.shortcut[^]{0,120}bg-paper-200\/80/)
  })
})
