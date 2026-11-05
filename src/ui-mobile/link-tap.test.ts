import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { EDITOR_LINK, isLinkTap, LINK_TAP_MAX_MS, LINK_TAP_SLOP, linkTargetAt, TABLE_CELL_LINK } from './link-tap.ts'

const start = { x: 100, y: 200, at: 1000 }
const shell = readFileSync(new URL('./MobileShell.tsx', import.meta.url), 'utf8')
const hook = shell.slice(shell.indexOf('function useWikilinkTapNavigation'), shell.indexOf('* Breadcrumb navigation (phone)'))

describe('a tap on an editor link', () => {
  it('is a quick release in place', () => {
    assert.equal(isLinkTap(start, { x: 104, y: 196, at: 1120 }), true)
  })

  it('is not a touch that travelled, either way', () => {
    assert.equal(isLinkTap(start, { x: 100, y: 200 - LINK_TAP_SLOP - 1, at: 1120 }), false)
    assert.equal(isLinkTap(start, { x: 100 + LINK_TAP_SLOP + 1, y: 200, at: 1120 }), false)
  })

  it('is not a hold', () => {
    assert.equal(isLinkTap(start, { x: 100, y: 200, at: 1000 + LINK_TAP_MAX_MS }), false)
  })

  it('finds the target of a note link and a table cell link', () => {
    const on = (selector: string, dataset: Record<string, string>) => ({
      closest: (s: string) => (s === selector ? { dataset } : null)
    })
    assert.equal(linkTargetAt(on(EDITOR_LINK, { target: 'Note' })), 'Note')
    assert.equal(linkTargetAt(on(TABLE_CELL_LINK, { wikilink: 'Cell' })), 'Cell')
    assert.equal(linkTargetAt({ closest: () => null }), undefined)
    assert.equal(linkTargetAt(null), undefined)
  })
})

describe('the shell hook', () => {
  it('lets a scroll start on a link: nothing is prevented until the release', () => {
    const onStart = hook.slice(hook.indexOf('const onTouchStart'), hook.indexOf('const onTouchMove'))
    assert.doesNotMatch(onStart, /preventDefault/)
    assert.doesNotMatch(onStart, /openWikilinkFromTouch/)
    const onEnd = hook.slice(hook.indexOf('const onTouchEnd'), hook.indexOf('const forget'))
    assert.match(onEnd, /preventDefault/)
    assert.match(onEnd, /openWikilinkFromTouch/)
  })

  it('gives up on a touch that a scroll took over', () => {
    assert.match(hook, /addEventListener\('touchcancel', forget/)
    assert.match(hook, /addEventListener\('pointercancel', forget/)
    assert.match(hook, /addEventListener\('scroll', forget/)
  })
})
