import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import postcss from 'postcss'
import { HIDDEN_SETTING_RESULTS, PHONE_HIDDEN_SUB_TABS, TABLET_HIDDEN_SUB_TABS } from './settings-sections.ts'

// The hidden results list against what it copies: the settings core puts on
// each sub-tab this shell hides, and the rows mobile.css hides. A new setting
// on a hidden sub-tab, or a newly hidden row, fails here at the next adoption
// instead of leaking into Settings search.

const modal = readFileSync(
  new URL('../../node_modules/@zennotes/app-core/dist/components/SettingsModal.js', import.meta.url),
  'utf8'
)

/** The search ids core gives a Settings sub-tab, by its title. */
function subTabIds(title: string): string[] {
  const match = modal.match(
    new RegExp(`title: "${title}",(?:\\s*description:[^\\n]*\\n)?\\s*searchIds: \\[([^\\]]*)\\]`)
  )
  assert.ok(match, `core has no Settings sub-tab titled ${title}`)
  return [...match[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!)
}

/** A searchable setting's title as the phones see it (core runs as `web`),
 *  or null when the id is not a search item. */
function settingTitle(id: string): string | null {
  const match = modal.match(new RegExp(`id: "${id}",\\s*\\n\\s*title: ([^\\n]+)`))
  if (!match) return null
  const title = match[1]!.trim().replace(/,$/, '')
  const runtime = title.match(/\? "[^"]+" : "([^"]+)"$/)
  return runtime ? runtime[1]! : JSON.parse(title)
}

/** Listed as a setting on that hidden sub-tab. */
function listedOnTab(title: string, tab: string): boolean {
  return HIDDEN_SETTING_RESULTS.some((entry) => entry.title === title && entry.tab === tab)
}

/** Listed as a row mobile.css hides (in the phone layout only, or always),
 *  or on a sub-tab hidden on every device, which hides it everywhere anyway. */
function listedAsRow(title: string, phoneOnly: boolean): boolean {
  return HIDDEN_SETTING_RESULTS.some(
    (entry) =>
      entry.title === title &&
      (entry.tab ? TABLET_HIDDEN_SUB_TABS.includes(entry.tab) : Boolean(entry.phoneOnly) === phoneOnly)
  )
}

/** Setting ids whose own row (or the section holding it) mobile.css hides. */
function cssHiddenIds(): { always: Set<string>; phone: Set<string> } {
  const always = new Set<string>()
  const phone = new Set<string>()
  postcss.parse(readFileSync(new URL('./mobile.css', import.meta.url), 'utf8')).walkRules((rule) => {
    let hides = false
    rule.walkDecls('display', (decl) => {
      if (decl.value.startsWith('none')) hides = true
    })
    if (!hides) return
    for (const selector of rule.selectors) {
      for (const m of selector.matchAll(/data-settings-search-id='([^']+)'\]/g)) {
        // Not a rule for something inside the row: nothing may follow the
        // attribute but closing parentheses.
        if (selector.slice(m.index! + m[0].length).replace(/\)/g, '').trim()) continue
        ;(selector.includes('.zn-phone') ? phone : always).add(m[1]!)
      }
    }
  })
  return { always, phone }
}

describe('the hidden results list against core and mobile.css', () => {
  it('holds every setting of each sub-tab the shell hides, under that tab', () => {
    for (const tab of PHONE_HIDDEN_SUB_TABS) {
      for (const id of subTabIds(tab)) assert.ok(listedOnTab(settingTitle(id)!, tab), `${tab}: ${id}`)
    }
  })

  it('holds every searchable row mobile.css hides', () => {
    const { always, phone } = cssHiddenIds()
    for (const id of always) {
      const title = settingTitle(id)
      if (title) assert.ok(listedAsRow(title, false), id)
    }
    for (const id of phone) {
      const title = settingTitle(id)
      if (title) assert.ok(listedAsRow(title, true), id)
    }
  })
})
