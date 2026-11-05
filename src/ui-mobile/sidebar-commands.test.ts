import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const shell = readFileSync(new URL('./MobileShell.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./mobile.css', import.meta.url), 'utf8')
const button = shell.slice(
  shell.indexOf('function SidebarCommandsButton'),
  shell.indexOf('function useSidebarCommandsEntry')
)
const hook = shell.slice(
  shell.indexOf('function useSidebarCommandsEntry'),
  shell.indexOf('function useVaultSettingsRows')
)

describe('Commands in the iPad sidebar footer', () => {
  it('is off a phone, which has the circle and no sidebar', () => {
    assert.match(hook, /if \(isPhoneWidth\(\)\) return/)
    assert.match(shell, /\n  useSidebarCommandsEntry\(\)\n/)
  })

  it('is one word that opens the palette', () => {
    assert.match(button, />Commands</)
    assert.match(button, /onClick=\{\(\) => showCommandPalette\(\)\}/)
    assert.doesNotMatch(button, /<svg/)
  })

  it('takes the empty cell left of Help and leaves a Files button alone', () => {
    assert.match(hook, /\.zn-sidebar-footer-safe > button\[data-sidebar-type="help"\]/)
    assert.match(hook, /previousElementSibling/)
    assert.match(hook, /slot\?\.tagName === 'DIV'/)
  })

  it('stays out of the sidebar keyboard order', () => {
    assert.doesNotMatch(button, /data-sidebar-idx/)
  })

  it('can shrink rather than push Help and Settings out of a narrow sidebar', () => {
    assert.match(button, /min-w-0/)
    assert.match(button, /className="truncate"/)
    assert.match(css, /\.zn-sidebar-commands-host \{[^}]*min-width: 0/)
    assert.match(css, /\.zn-sidebar-commands-host \{[^}]*display: flex/)
  })
})
