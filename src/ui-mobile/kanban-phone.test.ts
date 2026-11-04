import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import postcss from 'postcss'

// Core 2.80's board on the phone layout (ZenNotes/zennotes#1025, #1027,
// #1028, #1026): what a touch screen needs that core's desktop board gets
// from a mouse and a keyboard. Each core marker is checked too, so a rename
// there fails here at the next adoption instead of silently on a phone.

const core = (path: string): string =>
  readFileSync(new URL(`../../node_modules/@zennotes/app-core/dist/${path}`, import.meta.url), 'utf8')
const kanban = core('components/TasksKanban.js')
const shell = readFileSync(new URL('./MobileShell.tsx', import.meta.url), 'utf8')
const css = postcss.parse(readFileSync(new URL('./mobile.css', import.meta.url), 'utf8'))

function declaration(selector: string, property: string): string | undefined {
  let result: string | undefined
  css.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return
    rule.walkDecls(property, (decl) => { result = decl.value })
  })
  return result
}

describe('column and lane menus on a phone', () => {
  it('core opens them only on a right-click: Set WIP limit… on a column header, folding on a lane header', () => {
    assert.match(kanban, /"data-kanban-column-header": true,[^]{0,200}onContextMenu:/)
    assert.match(kanban, /"data-kanban-lane-header": true/)
    assert.match(kanban, /Set WIP limit/)
  })

  it('a long-press on either header opens its menu', () => {
    const surfaces = shell.slice(shell.indexOf('const LONG_PRESS_SURFACES ='), shell.indexOf('function useLongPressContextMenu'))
    assert.match(surfaces, /\[data-kanban-column-header\]/)
    assert.match(surfaces, /\[data-kanban-lane-header\]/)
  })
})

describe('a database Board card on a phone (ZenNotes/zennotes#1038)', () => {
  const board = core('components/DatabaseBoardView.js')

  it('core moves a card by HTML drag, or from its right-click menu', () => {
    assert.match(board, /"data-db-board-card": row\.id, draggable: true,[^]{0,400}onContextMenu:/)
    assert.match(board, /label: `Move to \$\{columnLabel\(c\.key\)\}`/)
  })

  it('a long-press on a card opens that menu', () => {
    const surfaces = shell.slice(shell.indexOf('const LONG_PRESS_SURFACES ='), shell.indexOf('function useLongPressContextMenu'))
    assert.match(surfaces, /\[data-db-board-card\]/)
  })
})

describe('a database Table row on a phone', () => {
  const table = core('components/DatabaseTableView.js')

  it('core gives a row a right-click menu', () => {
    assert.match(table, /group\/row border-b/)
    assert.match(table, /Open page/)
  })

  it('a long-press on a row opens that menu', () => {
    const surfaces = shell.slice(shell.indexOf('const LONG_PRESS_SURFACES ='), shell.indexOf('function useLongPressContextMenu'))
    assert.match(surfaces, /tr\.group\\\\\/row/)
  })
})

describe('the Files rows and selected tag chips on a phone', () => {
  const surfaces = shell.slice(shell.indexOf('const LONG_PRESS_SURFACES ='), shell.indexOf('function useLongPressContextMenu'))

  it('core gives an asset row its menu and marks it as the shell looks for it', () => {
    const assets = core('components/AssetsView.js')
    assert.match(assets, /role: ['"]button['"][^]{0,900}onContextMenu:[^]{0,300}group cursor-pointer[^]{0,300}title: asset\.path/)
    assert.match(surfaces, /li > div\[role="button"\]\.group\[title\]/)
  })

  it('core gives a selected tag chip its menu and the title the shell looks for', () => {
    const tags = core('components/TagView.js')
    assert.match(tags, /onContextMenu:[^]{0,400}title: "Click to remove/)
    assert.match(surfaces, /button\[title\^="Click to remove"\]/)
  })

  it('strips the menu row that does nothing here', () => {
    assert.match(shell, /DEVICE_HIDDEN_MENU_ITEMS = new Set\(\[[^\]]*'Reveal in file manager'/)
  })
})

describe('a card\'s subtask bar beside the move handle', () => {
  it('core draws the bar as a full-width row in the card', () => {
    assert.match(kanban, /"data-kanban-progress": true[^]*?className: "group\/summary mt-1\.5 flex w-full items-center/)
  })

  it('the row ends where the 30 px handle, 4 px from the edge, starts', () => {
    assert.equal(declaration('.zn-phone .zn-kanban-move', 'width'), '30px')
    assert.equal(declaration('.zn-phone .zn-kanban-move', 'right'), '4px')
    assert.equal(declaration('.zn-mobile.zn-phone [data-kanban-task-id] [data-kanban-progress]', 'padding-right'), '34px')
  })
})

describe('the Tasks Keys button on a phone', () => {
  it('core marks the button that opens the key sheet', () => {
    assert.match(core('components/TasksToolbar.js'), /"data-tasks-keys": true, "aria-label": "Keyboard shortcuts"/)
  })

  it('is hidden on phones, as the hint strips it replaced were', () => {
    assert.equal(declaration('.zn-mobile.zn-phone [data-tasks-keys]', 'display'), 'none')
  })

  it('lays its sheet out in one column with whole key chips where it shows narrow', () => {
    const toolbar = core('components/TasksToolbar.js')
    assert.match(toolbar, /"data-tasks-keys-popover": true[^]*?className: "grid grid-cols-2/)
    assert.equal(declaration('.zn-mobile [data-tasks-keys-popover] > .grid', 'grid-template-columns'), 'minmax(0, 1fr)')
    assert.equal(declaration('.zn-mobile [data-tasks-keys-popover] kbd', 'flex-shrink'), '0')
  })
})

describe('the lanes board scrolling both ways', () => {
  it('leaves the corner where its two scrollbars meet transparent, not painted white', () => {
    assert.equal(declaration('.zn-mobile ::-webkit-scrollbar-corner', 'background'), 'transparent')
  })
})
