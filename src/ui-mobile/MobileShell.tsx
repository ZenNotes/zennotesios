/**
 * Mobile-only chrome layered over the shared app-core UI (spec 07): bottom
 * navigation (capture is the hero action), an iOS-style action sheet that
 * reuses the shared command registry, drawer behavior for the sidebar, and a
 * "mobilizer" that turns the desktop two-pane Settings dialog into a paged
 * full-screen flow. Rendered into its own React root so app-core stays
 * untouched; state is driven through the shared Zustand store.
 */
import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { useStore } from '@zennotes/app-core/store'
import { buildCommands } from '@zennotes/app-core/lib/commands'
import { findLeaf, updateLeaf } from '@zennotes/app-core/lib/pane-layout'
import {
  isSameFileHeadingLink,
  resolveWikilinkTarget,
  wikilinkHeadingAnchor
} from '@zennotes/app-core/lib/wikilinks'
import {
  openDatabaseFromWikilink,
  openWikilinkHeading
} from '@zennotes/app-core/lib/wikilink-navigation'
import { MobileEditorToolbar } from './EditorToolbar'
import { promptApp } from '@zennotes/app-core/lib/prompt-requests'
import { confirmApp } from '@zennotes/app-core/lib/confirm-requests'
import { csvPathFromDatabaseTab, formDirFromCsvPath } from '@zennotes/shared-domain/databases'
import { MobileDrawer } from './MobileDrawer'
import { isDrawerOpen, setDrawerOpen, useDrawerOpen } from './drawer-state'
import ensoUrl from '../assets/enso.png'
import {
  disableICloud,
  enableICloud,
  getStoragePref,
  icloudStatus
} from '../bridge/icloud'

const PHONE_BREAKPOINT = 768

function isPhoneWidth(): boolean {
  return window.innerWidth < PHONE_BREAKPOINT
}

/** Run a command from the shared registry by id (same path the palette uses). */
function runCommand(id: string): void {
  const cmd = buildCommands({ includeUnavailable: true }).find((c) => c.id === id)
  if (!cmd) return
  if (cmd.when && !cmd.when()) return
  void cmd.run()
}

/**
 * Show the Home dashboard (Notion-style): deselect the active tab without
 * closing anything, so HomeView renders while open tabs stay reachable via
 * "Open notes". There's no store action for this — desktop only reaches Home
 * by closing every tab — so the shell drives the pane tree directly.
 */
function goHome(): void {
  const s = useStore.getState()
  if (s.selectedPath && s.noteDirty[s.selectedPath]) {
    void s.persistNote(s.selectedPath)
  }
  const leaf = findLeaf(s.paneLayout, s.activePaneId)
  if (!leaf || leaf.activeTab === null) return
  const next = updateLeaf(s.paneLayout, leaf.id, (l) => ({ ...l, activeTab: null }))
  if (!next) return
  useStore.setState({
    paneLayout: next,
    selectedPath: null,
    activeNote: null,
    activeDirty: false
  })
}

function Icon({ d, filled }: { d: string; filled?: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  sidebar: 'M3 5.5h18M3 12h18M3 18.5h12',
  back: 'M14.5 5l-7 7 7 7',
  capture: 'M12 5v14M5 12h14',
  search: 'M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z',
  more: 'M5.5 12h.01M12 12h.01M18.5 12h.01',
  palette: 'M4 5h16M4 10h16M4 15h10M4 20h6',
  cloud: 'M17.5 19a4.5 4.5 0 001.03-8.88 6 6 0 00-11.77 1.13A3.75 3.75 0 007.25 19h10.25z',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
  calendar:
    'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
  note: 'M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6zM14 3v6h6',
  template: 'M4 4h16v16H4zM4 9h16M9 9v11',
  database: 'M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3zM3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3',
  folderPlus: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM12 11v6M9 14h6',
  tabs: 'M4 6h16M4 6v12h16V6M9 6v12',
  outline: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  rename: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  move: 'M5 8V6a2 2 0 012-2h3l2 2h7a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2v-4M2 13h9m0 0l-3-3m3 3l-3 3',
  link: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71',
  archive: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  trash: 'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
  textSearch: 'M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0zM8 9h5M8 12h3'
}

interface SheetRow {
  id: string
  label: string
  icon: string
  danger?: boolean
}

const RESTORE_ICON = 'M3 9l4-4m-4 4l4 4M3 9h13a5 5 0 015 5v0a5 5 0 01-5 5H9'

function noteRowsFor(folder: string | null): SheetRow[] {
  const base: SheetRow[] = [
    { id: 'nav.outline', label: 'Outline', icon: ICONS.outline },
    { id: 'note.rename', label: 'Rename', icon: ICONS.rename },
    { id: 'note.move', label: 'Move to…', icon: ICONS.move },
    { id: 'note.copy-wikilink', label: 'Copy wikilink', icon: ICONS.link }
  ]
  if (folder === 'archive') {
    base.push({ id: 'note.unarchive', label: 'Unarchive', icon: RESTORE_ICON })
  } else if (folder === 'trash') {
    base.push({ id: 'note.restore', label: 'Restore', icon: RESTORE_ICON })
  } else {
    base.push({ id: 'note.archive', label: 'Archive', icon: ICONS.archive })
  }
  if (folder !== 'trash') {
    base.push({ id: 'note.trash', label: 'Delete', icon: ICONS.trash, danger: true })
  }
  return base
}

const APP_ROWS: SheetRow[] = [
  { id: 'tab.buffers', label: 'Open notes', icon: ICONS.tabs },
  { id: 'nav.search-text', label: 'Search in all notes', icon: ICONS.textSearch },
  { id: 'zn.palette', label: 'All commands…', icon: ICONS.palette },
  { id: 'zn.icloud', label: 'iCloud Sync', icon: ICONS.cloud },
  { id: 'zn.pickfolder', label: 'Open folder as vault…', icon: ICONS.folder },
  { id: 'app.settings', label: 'Settings', icon: ICONS.settings }
]

function ActionSheet({
  onClose,
  onOpenICloud
}: {
  onClose: () => void
  onOpenICloud: () => void
}): React.JSX.Element {
  const selectedPath = useStore((s) => s.selectedPath)
  // Virtual tabs (zen://help, zen://tasks, ...) aren't notes — their rows
  // (rename/trash/...) would silently no-op.
  const hasNote = Boolean(selectedPath) && !selectedPath?.startsWith('zen://')
  const noteFolder = useStore((s) => {
    if (!s.selectedPath) return null
    return s.notes.find((n) => n.path === s.selectedPath)?.folder ?? null
  })
  const calendarAvailable = useStore(
    (s) => s.vaultSettings.dailyNotes.enabled || s.vaultSettings.weeklyNotes.enabled
  )
  // With a database tab open, offer its removal — every open thing should be
  // deletable from •••.
  const dbFormDir = useStore((s) => {
    const csv = csvPathFromDatabaseTab(s.selectedPath)
    return csv ? formDirFromCsvPath(csv) : null
  })
  const dbTitle = dbFormDir
    ? (dbFormDir.split('/').pop() ?? '').replace(/\.base$/i, '')
    : null
  const title = useStore((s) => {
    if (!s.selectedPath) return 'ZenNotes'
    const note = s.notes.find((n) => n.path === s.selectedPath)
    return note?.title ?? 'ZenNotes'
  })

  const deleteOpenDatabase = (): void => {
    const formDir = dbFormDir
    const label = dbTitle
    if (!formDir || label === null) return
    onClose()
    window.setTimeout(() => {
      void (async () => {
        const ok = await confirmApp({
          title: `Delete "${label}"?`,
          description: 'All records will be permanently deleted. This cannot be undone.',
          confirmLabel: 'Delete',
          danger: true
        })
        if (!ok) return
        const subpath = formDir.startsWith('inbox/') ? formDir.slice(6) : formDir
        await useStore.getState().deleteFolder('inbox', subpath)
      })()
    }, 30)
  }

  const run = (id: string): void => {
    onClose()
    // Let the sheet unmount before the command opens palettes/prompts, so
    // focus lands in the right place.
    window.setTimeout(() => {
      if (id === 'zn.palette') {
        useStore.getState().setCommandPaletteOpen(true)
        return
      }
      if (id === 'zn.icloud') {
        onOpenICloud()
        return
      }
      if (id === 'zn.pickfolder') {
        void useStore.getState().openVaultPicker()
        return
      }
      if (id === 'note.trash') {
        // Own the confirm copy ("Delete") — app-core's command would show its
        // desktop "Move to Trash?" dialog. The bridge's unlink event closes
        // the tab via applyChange.
        void (async () => {
          const st = useStore.getState()
          const path = st.selectedPath
          if (!path) return
          const noteTitle = st.notes.find((n) => n.path === path)?.title
          const ok = await confirmApp({
            title: `Delete "${noteTitle ?? 'this note'}"?`,
            description: 'It will move to the trash.',
            confirmLabel: 'Delete',
            danger: true
          })
          if (ok) await window.zen.moveToTrash(path)
        })()
        return
      }
      runCommand(id)
    }, 30)
  }

  return (
    <>
      <div className="zn-mobile-sheet-backdrop" onClick={onClose} role="presentation" />
      <div className="zn-mobile-sheet" role="menu" aria-label="Note actions">
        <div className="zn-mobile-sheet-title">{dbTitle ?? title}</div>
        {hasNote && (
          <div className="zn-mobile-seg" role="group" aria-label="View mode">
            <button type="button" onClick={() => run('view.mode.edit')}>
              Edit
            </button>
            <button type="button" onClick={() => run('view.mode.preview')}>
              Read
            </button>
          </div>
        )}
        <div className="zn-mobile-sheet-scroll">
          {hasNote && calendarAvailable && (
            <div className="zn-mobile-sheet-group">
              <button
                type="button"
                className="zn-mobile-sheet-row"
                onClick={() => {
                  onClose()
                  window.setTimeout(
                    () => window.dispatchEvent(new Event('zen:toggle-calendar')),
                    30
                  )
                }}
              >
                <Icon d={ICONS.calendar} />
                Calendar
              </button>
            </div>
          )}
          {dbFormDir && (
            <div className="zn-mobile-sheet-group">
              <button
                type="button"
                className="zn-mobile-sheet-row zn-danger"
                onClick={deleteOpenDatabase}
              >
                <Icon d={ICONS.trash} />
                Delete
              </button>
            </div>
          )}
          {hasNote && (
            <div className="zn-mobile-sheet-group">
              {noteRowsFor(noteFolder).map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`zn-mobile-sheet-row${row.danger ? ' zn-danger' : ''}`}
                  onClick={() => run(row.id)}
                >
                  <Icon d={row.icon} />
                  {row.label}
                </button>
              ))}
            </div>
          )}
          <div className="zn-mobile-sheet-group">
            {APP_ROWS.map((row) => (
              <button
                key={row.id}
                type="button"
                className="zn-mobile-sheet-row"
                onClick={() => run(row.id)}
              >
                <Icon d={row.icon} />
                {row.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * The ⊕ create sheet — desktop's create menu (New note / template / database
 * / folder) minus drawing (view-only on phones), with quick capture as the
 * hero first row. Daily note rides along when enabled: the home screen's
 * quick-action chips are hidden on phones, so this is its one-tap home.
 */
function CreateSheet({ onClose }: { onClose: () => void }): React.JSX.Element {
  const dailyEnabled = useStore((s) => s.vaultSettings.dailyNotes.enabled)
  const run = (fn: () => unknown): void => {
    onClose()
    window.setTimeout(() => void fn(), 30)
  }

  const newFolder = async (): Promise<void> => {
    const name = await promptApp({
      title: 'New folder',
      placeholder: 'Folder name',
      okLabel: 'Create',
      validate: (v: string) => (v.includes('/') ? 'Folder name cannot contain "/"' : null)
    })
    const clean = name?.trim().replace(/^\/+|\/+$/g, '')
    if (!clean) return
    await useStore.getState().createFolder('inbox', clean)
  }

  return (
    <>
      <div className="zn-mobile-sheet-backdrop" onClick={onClose} role="presentation" />
      <div className="zn-mobile-sheet" role="menu" aria-label="Create">
        <div className="zn-mobile-sheet-title">Create</div>
        <div className="zn-mobile-sheet-scroll">
          <div className="zn-mobile-sheet-group">
            <button
              type="button"
              className="zn-mobile-sheet-row"
              onClick={() => run(() => runCommand('note.new.quick'))}
            >
              <Icon d={ICONS.capture} />
              Quick note
            </button>
            <button
              type="button"
              className="zn-mobile-sheet-row"
              onClick={() => run(() => runCommand('note.new.inbox'))}
            >
              <Icon d={ICONS.note} />
              New note
            </button>
            {dailyEnabled && (
              <button
                type="button"
                className="zn-mobile-sheet-row"
                onClick={() => run(() => useStore.getState().openTodayDailyNote())}
              >
                <Icon d={ICONS.calendar} />
                Daily note
              </button>
            )}
            <button
              type="button"
              className="zn-mobile-sheet-row"
              onClick={() => run(() => useStore.getState().setTemplatePaletteOpen(true))}
            >
              <Icon d={ICONS.template} />
              New from template
            </button>
            <button
              type="button"
              className="zn-mobile-sheet-row"
              onClick={() => run(() => runCommand('database.new'))}
            >
              <Icon d={ICONS.database} />
              New database
            </button>
            <button
              type="button"
              className="zn-mobile-sheet-row"
              onClick={() => run(() => newFolder())}
            >
              <Icon d={ICONS.folderPlus} />
              New folder
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

type ICloudSheetState = 'loading' | 'unavailable' | 'on' | 'off' | 'busy' | 'error'

function ICloudSheet({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [state, setState] = useState<ICloudSheetState>('loading')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const vaultName = useStore((s) => s.vault?.name ?? 'My Vault')

  useEffect(() => {
    void icloudStatus().then((st) => {
      if (!st.available) setState('unavailable')
      else setState(getStoragePref() === 'icloud' ? 'on' : 'off')
    })
  }, [])

  const act = (fn: () => Promise<unknown>): void => {
    setState('busy')
    void fn()
      .then(() => window.location.reload())
      .catch((err) => {
        setError(String((err as Error)?.message ?? err))
        setState('error')
      })
  }

  return (
    <>
      <div className="zn-mobile-sheet-backdrop" onClick={onClose} role="presentation" />
      <div className="zn-mobile-sheet" role="dialog" aria-label="iCloud Sync">
        <div className="zn-mobile-sheet-title">iCloud Sync</div>
        <div className="zn-mobile-sheet-scroll">
          {state === 'loading' && <p className="zn-mobile-sheet-note">Checking iCloud…</p>}
          {state === 'busy' && <p className="zn-mobile-sheet-note">Moving your vault…</p>}
          {state === 'unavailable' && (
            <p className="zn-mobile-sheet-note">
              iCloud isn't available on this device. Sign in to iCloud and turn on iCloud Drive
              in Settings, then try again.
            </p>
          )}
          {state === 'error' && <p className="zn-mobile-sheet-note zn-danger">{error}</p>}
          {state === 'on' && (
            <>
              <p className="zn-mobile-sheet-note">
                "{vaultName}" lives in iCloud Drive and syncs across your devices. On a Mac it
                appears in iCloud Drive › ZenNotes.
              </p>
              <div className="zn-mobile-sheet-group">
                <button
                  type="button"
                  className={`zn-mobile-sheet-row${confirming ? ' zn-danger' : ''}`}
                  onClick={() => {
                    if (!confirming) {
                      setConfirming(true)
                      return
                    }
                    act(() => disableICloud(vaultName))
                  }}
                >
                  <Icon d={ICONS.cloud} />
                  {confirming ? 'Tap again to move it off iCloud' : 'Move vault back to this device'}
                </button>
              </div>
            </>
          )}
          {state === 'off' && (
            <>
              <p className="zn-mobile-sheet-note">
                Sync "{vaultName}" across your devices with iCloud Drive. Your notes move into
                iCloud Drive › ZenNotes — they stay plain Markdown files, and a Mac can open
                that folder as a vault.
              </p>
              <div className="zn-mobile-sheet-group">
                <button
                  type="button"
                  className="zn-mobile-sheet-row"
                  onClick={() => {
                    if (!confirming) {
                      setConfirming(true)
                      return
                    }
                    act(() => enableICloud(vaultName))
                  }}
                >
                  <Icon d={ICONS.cloud} />
                  {confirming ? 'Tap again to confirm' : 'Enable iCloud Sync'}
                </button>
                <button
                  type="button"
                  className="zn-mobile-sheet-row"
                  onClick={() => {
                    onClose()
                    window.setTimeout(() => {
                      void useStore.getState().openVaultPicker()
                    }, 30)
                  }}
                >
                  <Icon d={ICONS.folder} />
                  Use an existing iCloud Drive folder…
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function MobileNav(): React.JSX.Element | null {
  const vault = useStore((s) => s.vault)
  const setSearchOpen = useStore((s) => s.setSearchOpen)
  const canJumpBack = useStore((s) => s.noteBackstack.length > 0)
  const hasNote = useStore((s) => Boolean(s.selectedPath))
  const [sheetOpen, setSheetOpen] = useState(false)
  const [icloudOpen, setICloudOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [fabOpen, setFabOpen] = useState(false)

  if (!vault) return null

  const toggleFab = (): void => {
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
    setFabOpen((v) => !v)
  }

  // Back = note jump history when there is one; otherwise pop "up" to the
  // Home dashboard (iOS hierarchy feel). The jump history isn't persisted
  // across launches, so without the fallback this action reads as broken
  // after a cold start.
  const goBack = (): void => {
    if (canJumpBack) {
      runCommand('nav.back')
      return
    }
    goHome()
  }

  // One floating circle bottom-right; tapping it fans out the nav actions
  // (Adib: "very minimal and clean" — no persistent bar eating the screen).
  // Order: thumb-nearest first. Back is omitted when it would be a no-op.
  const fabActions: Array<{ label: string; icon: string; run: () => void } | null> = [
    { label: 'More', icon: ICONS.more, run: () => setSheetOpen(true) },
    { label: 'Browse', icon: ICONS.sidebar, run: () => setDrawerOpen(true) },
    canJumpBack || hasNote ? { label: 'Back', icon: ICONS.back, run: goBack } : null,
    { label: 'Search', icon: ICONS.search, run: () => setSearchOpen(true) },
    { label: 'New', icon: ICONS.capture, run: () => setCreateOpen(true) }
  ]

  return (
    <>
      {fabOpen && (
        <>
          <div
            className="zn-mobile-fab-backdrop"
            role="presentation"
            onClick={() => setFabOpen(false)}
          />
          <div className="zn-mobile-fab-menu" role="menu" aria-label="Navigation">
            {fabActions.map(
              (action) =>
                action && (
                  <button
                    key={action.label}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setFabOpen(false)
                      action.run()
                    }}
                  >
                    {action.label}
                    <Icon d={action.icon} />
                  </button>
                )
            )}
          </div>
        </>
      )}
      <button
        type="button"
        aria-label={fabOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={fabOpen}
        className={`zn-mobile-fab${fabOpen ? ' open' : ''}`}
        onClick={toggleFab}
      >
        <img src={ensoUrl} alt="" aria-hidden="true" />
      </button>
      {sheetOpen && (
        <ActionSheet onClose={() => setSheetOpen(false)} onOpenICloud={() => setICloudOpen(true)} />
      )}
      {icloudOpen && <ICloudSheet onClose={() => setICloudOpen(false)} />}
      {createOpen && <CreateSheet onClose={() => setCreateOpen(false)} />}
    </>
  )
}

/**
 * One-time phone-layout normalization: once the workspace has restored, close
 * the desktop-sized panels and land on the Home dashboard (Notion-style —
 * restored tabs stay open behind it, reachable via "Open notes"). Runs per
 * launch, not per snapshot write, so the user can still open the drawers
 * freely afterwards.
 */
function usePhoneLayoutBoot(): void {
  useEffect(() => {
    if (!isPhoneWidth()) return
    let done = false
    const apply = (): void => {
      const s = useStore.getState()
      if (done || !s.vault || !s.workspaceRestored) return
      done = true
      // Panels close, and daily/weekly notes must not auto-summon the
      // calendar over a phone-sized editor (it's one tap away in •••).
      useStore.setState({ sidebarOpen: false, noteListOpen: false, autoCalendarPanel: false })
      goHome()
      unsub()
    }
    const unsub = useStore.subscribe(apply)
    apply()
    return () => unsub()
  }, [])
}

/**
 * Mirror of the editor's `openWikilink` (cm-wikilink-render.ts, not exported)
 * built from the same shared helpers, minus the desktop editor-refocus (we
 * don't want the soft keyboard popping up after a navigation tap).
 */
function openWikilinkFromTouch(target: string): void {
  const s = useStore.getState()
  const anchor = wikilinkHeadingAnchor(target)
  const resolved = resolveWikilinkTarget(s.notes, target)
  if (!resolved) {
    if (anchor && isSameFileHeadingLink(target) && s.selectedPath) {
      void openWikilinkHeading(s.selectedPath, anchor)
      return
    }
    openDatabaseFromWikilink(target)
    return
  }
  if (!anchor) {
    void s.selectNote(resolved.path)
    return
  }
  void openWikilinkHeading(resolved.path, anchor)
}

/**
 * Tap-to-follow wikilinks in the editor. The shared extension follows links
 * on `mousedown`, but on iOS the preceding touch moves the CodeMirror
 * selection, which reveals the raw `[[...]]` source and removes the rendered
 * link before any mouse event fires — so taps just placed the caret (spec 06
 * wants tap = navigate). Intercepting `touchstart` runs before CodeMirror.
 */
function useWikilinkTapNavigation(): void {
  useEffect(() => {
    const onTouchStart = (e: TouchEvent): void => {
      const el = (e.target as HTMLElement | null)?.closest?.('.cm-wikilink')
      const target = el instanceof HTMLElement ? el.dataset.target : undefined
      if (!target) return
      e.preventDefault()
      e.stopPropagation()
      openWikilinkFromTouch(target)
    }
    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: false })
    return () =>
      document.removeEventListener('touchstart', onTouchStart, { capture: true } as never)
  }, [])
}

/**
 * Breadcrumb navigation (phone): tapping a folder crumb runs the shared
 * `setView(folder)` — invisible on a phone — so the shell opens the mobile
 * drawer as the visible navigation response.
 */
function useBreadcrumbDrawerNav(): void {
  useEffect(() => {
    if (!isPhoneWidth()) return
    const onClick = (e: MouseEvent): void => {
      const crumb = (e.target as HTMLElement | null)?.closest?.('button[data-crumb-menu]')
      if (!crumb) return
      window.setTimeout(() => setDrawerOpen(true), 50)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])
}

/**
 * Long-press → context menu. Desktop flows (folder/note actions, tag filters,
 * tab menus) hang off `onContextMenu`, which iOS never fires. A 450ms
 * single-finger press on chrome surfaces (sidebar, breadcrumb, note list —
 * NOT the editor, which keeps native text selection) synthesizes a
 * `contextmenu` MouseEvent that React's existing handlers pick up.
 */
const LONG_PRESS_SURFACES =
  'aside.glass-sidebar, header.glass-header, section.glass-column, [data-tab-menu-target]'

function useLongPressContextMenu(): void {
  useEffect(() => {
    let timer: number | null = null
    let startX = 0
    let startY = 0
    let pressTarget: HTMLElement | null = null
    let suppressNextClickUntil = 0

    const cancel = (): void => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      pressTarget = null
    }

    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) return
      const t = e.target as HTMLElement | null
      if (!t || typeof t.closest !== 'function') return
      if (t.closest('.cm-editor') || t.closest('input, textarea')) return
      if (!t.closest(LONG_PRESS_SURFACES)) return
      const touch = e.touches[0]!
      startX = touch.clientX
      startY = touch.clientY
      pressTarget = t
      timer = window.setTimeout(() => {
        timer = null
        const el = pressTarget
        pressTarget = null
        if (!el || !el.isConnected) return
        void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {})
        // The finger lift emits a synthetic mousedown/mouseup/click sequence;
        // ContextMenu closes on window mousedown, so swallow the whole burst
        // or the menu vanishes the instant it opens.
        suppressNextClickUntil = Date.now() + 700
        el.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: startX,
            clientY: startY
          })
        )
      }, 450)
    }

    const onTouchMove = (e: TouchEvent): void => {
      if (timer === null) return
      const touch = e.touches[0]!
      if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
        cancel()
      }
    }

    const suppressMouse = (e: MouseEvent): void => {
      if (Date.now() < suppressNextClickUntil) {
        e.preventDefault()
        e.stopPropagation()
        if (e.type === 'click') suppressNextClickUntil = 0
      }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true })
    document.addEventListener('touchmove', onTouchMove, { passive: true, capture: true })
    document.addEventListener('touchend', cancel, { passive: true, capture: true })
    document.addEventListener('touchcancel', cancel, { passive: true, capture: true })
    document.addEventListener('mousedown', suppressMouse, true)
    document.addEventListener('mouseup', suppressMouse, true)
    document.addEventListener('click', suppressMouse, true)
    return () => {
      cancel()
      document.removeEventListener('touchstart', onTouchStart, { capture: true } as never)
      document.removeEventListener('touchmove', onTouchMove, { capture: true } as never)
      document.removeEventListener('touchend', cancel, { capture: true } as never)
      document.removeEventListener('touchcancel', cancel, { capture: true } as never)
      document.removeEventListener('mousedown', suppressMouse, true)
      document.removeEventListener('mouseup', suppressMouse, true)
      document.removeEventListener('click', suppressMouse, true)
    }
  }, [])
}

/**
 * Placeholders like "Filter…  /  to focus" carry a keyboard hint that just
 * truncates on a phone — trim them as the inputs mount.
 */
function usePlaceholderCleanup(): void {
  useEffect(() => {
    if (!isPhoneWidth()) return
    const clean = (root: ParentNode): void => {
      for (const input of root.querySelectorAll<HTMLInputElement>(
        'input[placeholder*="to focus"]'
      )) {
        input.placeholder = input.placeholder.split('/')[0]!.trim()
      }
    }
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement) clean(node)
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    clean(document)
    return () => observer.disconnect()
  }, [])
}

/**
 * Edge-swipe drawer gestures (spec 07): swipe right from the left screen edge
 * to open the sidebar drawer; swipe left anywhere on the open drawer to close
 * it. Edge-start only, so editor text selection and horizontal scrollers
 * (kanban, toolbars) are never hijacked.
 */
function useEdgeSwipeDrawer(): void {
  useEffect(() => {
    if (!isPhoneWidth()) return
    const EDGE = 28
    const TRIGGER = 55
    const SLOP = 40
    let tracking: 'open' | 'close' | null = null
    let startX = 0
    let startY = 0

    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]!
      startX = t.clientX
      startY = t.clientY
      if (!isDrawerOpen() && t.clientX <= EDGE) {
        tracking = 'open'
      } else if (
        isDrawerOpen() &&
        (e.target as HTMLElement | null)?.closest?.('.zn-mobile-drawer')
      ) {
        tracking = 'close'
      } else {
        tracking = null
      }
    }

    const onTouchMove = (e: TouchEvent): void => {
      if (!tracking) return
      const t = e.touches[0]!
      const dx = t.clientX - startX
      const dy = Math.abs(t.clientY - startY)
      if (dy > SLOP) {
        tracking = null
        return
      }
      if (tracking === 'open' && dx > TRIGGER) {
        tracking = null
        setDrawerOpen(true)
      } else if (tracking === 'close' && dx < -TRIGGER) {
        tracking = null
        setDrawerOpen(false)
      }
    }

    const onTouchEnd = (): void => {
      tracking = null
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true })
    document.addEventListener('touchmove', onTouchMove, { passive: true, capture: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true, capture: true })
    return () => {
      document.removeEventListener('touchstart', onTouchStart, { capture: true } as never)
      document.removeEventListener('touchmove', onTouchMove, { capture: true } as never)
      document.removeEventListener('touchend', onTouchEnd, { capture: true } as never)
    }
  }, [])
}

/**
 * Right-hand panels (calendar/outline/connections/comments) render as
 * full-screen sheets on phones (CSS) — this injects a floating Done button
 * that dispatches app-core's own `zen:close-right-panel` event, since the
 * panels' open state lives inside EditorPane.
 */
/**
 * Desktop-only commands that app-core registers without a runtime gate. None
 * of these can work on iOS (App Store owns updates; no app zoom, floating
 * windows, or PDF export pipeline) — hide their palette rows on any device
 * width. Matched by title prefix against each row's text.
 */
const DESKTOP_ONLY_COMMAND_TITLES = [
  'Open Help',
  'Check for Updates',
  'Zoom In',
  'Zoom Out',
  'Reset Zoom',
  'Open in Floating Window',
  'Export Note as PDF',
  'Show Onboarding Wizard'
]

/** Additionally hidden on phones: splits/panes and the (replaced) sidebar
 *  exist on iPad but not in the phone layout. */
const PHONE_ONLY_HIDDEN_COMMAND_TITLES = [
  'Split Right',
  'Split Down',
  'Switch to Split Mode',
  'Focus Pane Left',
  'Focus Pane Below',
  'Focus Pane Above',
  'Focus Pane Right',
  'Focus Sidebar',
  'Toggle Sidebar',
  'Show Tags in Sidebar',
  'Hide Tags in Sidebar',
  'Toggle Note List Column',
  // Drawings are view-only on phones — creating one opens an uneditable
  // canvas. ('New Drawing' also catches 'Embed New Drawing' via the
  // .includes row match; 'Embed Existing Drawing…' stays, embeds render.)
  'New Drawing',
  'Embed New Drawing'
]

function useDesktopCommandCleanup(): void {
  useEffect(() => {
    let raf = 0
    const titles = isPhoneWidth()
      ? [...DESKTOP_ONLY_COMMAND_TITLES, ...PHONE_ONLY_HIDDEN_COMMAND_TITLES]
      : DESKTOP_ONLY_COMMAND_TITLES
    const sweep = (): void => {
      const palette = document.querySelector('.z-palette')
      if (!palette) return
      for (const row of palette.querySelectorAll<HTMLElement>('button')) {
        // Row text is "<CATEGORY><Title><shortcut>", so match by inclusion.
        const text = row.textContent ?? ''
        if (titles.some((t) => text.includes(t))) {
          row.style.display = 'none'
        }
      }
    }
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(sweep)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    sweep()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])
}

/**
 * Tasks calendar (phone): a 6-week month grid eats the whole screen, so the
 * shell adds a Week/Month scope. Week mode hides every `data-cal-day` cell
 * outside the week of the selected (or today's) cell — the grid is one flat
 * 42-cell list, so a week is a contiguous 7-cell run. A Week|Month segmented
 * control is injected next to the calendar's own Today button (a single
 * action-labeled pill read as a status chip, not a button — Adib's feedback).
 */
const CAL_SCOPE_KEY = 'zn-mobile:cal-scope'

function useCalendarWeekMode(): void {
  useEffect(() => {
    if (!isPhoneWidth()) return
    let control: HTMLDivElement | null = null
    let raf = 0

    const scope = (): 'week' | 'month' =>
      localStorage.getItem(CAL_SCOPE_KEY) === 'month' ? 'month' : 'week'

    const apply = (): void => {
      const cells = Array.from(
        document.querySelectorAll<HTMLButtonElement>('button[data-cal-day]')
      )
      const todayBtn = document.querySelector<HTMLElement>("button[title='Today (gt)']")
      if (cells.length === 0 || !todayBtn) {
        control?.remove()
        control = null
        document.documentElement.classList.remove('zn-cal-week')
        return
      }
      if (!control || !control.isConnected) {
        control = document.createElement('div')
        control.className = 'zn-cal-scope'
        control.setAttribute('role', 'group')
        control.setAttribute('aria-label', 'Calendar scope')
        for (const s of ['week', 'month'] as const) {
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.dataset.scope = s
          btn.textContent = s === 'week' ? 'Week' : 'Month'
          btn.addEventListener('click', () => {
            localStorage.setItem(CAL_SCOPE_KEY, s)
            apply()
          })
          control.appendChild(btn)
        }
        todayBtn.insertAdjacentElement('afterend', control)
      }
      const week = scope() === 'week'
      for (const btn of control.querySelectorAll<HTMLButtonElement>('button')) {
        const active = btn.dataset.scope === (week ? 'week' : 'month')
        btn.classList.toggle('is-active', active)
        btn.setAttribute('aria-pressed', String(active))
      }
      document.documentElement.classList.toggle('zn-cal-week', week)
      if (!week) {
        for (const cell of cells) cell.style.display = ''
        return
      }
      // Anchor: the selected cell (accent ring) if present, else today, else
      // the second row (first row is often entirely the previous month).
      const now = new Date()
      const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const anchor =
        cells.find((c) => c.className.includes('ring-2')) ??
        cells.find((c) => c.dataset.calDay === todayIso) ??
        cells[7]
      const idx = Math.max(0, cells.indexOf(anchor ?? cells[0]))
      const start = Math.floor(idx / 7) * 7
      cells.forEach((cell, i) => {
        cell.style.display = i >= start && i < start + 7 ? '' : 'none'
      })
    }

    const schedule = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(apply)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    // Selection changes flip cell classes without adding nodes — reapply on
    // taps anywhere in the grid.
    const onClick = (e: MouseEvent): void => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-cal-day], .zn-cal-scope')) schedule()
    }
    document.addEventListener('click', onClick, true)
    schedule()
    return () => {
      observer.disconnect()
      document.removeEventListener('click', onClick, true)
      cancelAnimationFrame(raf)
      control?.remove()
      document.documentElement.classList.remove('zn-cal-week')
    }
  }, [])
}

const RIGHT_PANEL_SELECTOR =
  '[data-calendar-panel], [data-connections-panel], [data-comments-panel], .zn-app-shell section[class*="border-l"][class*="shrink-0"], .zn-app-shell aside[class*="border-l"][class*="shrink-0"], .zn-app-shell div[class*="border-l"][class*="shrink-0"][class*="flex-col"]'

function useRightPanelCloseButton(): void {
  useEffect(() => {
    if (!isPhoneWidth()) return
    let button: HTMLButtonElement | null = null
    let raf = 0
    const sync = (): void => {
      const open = document.querySelector(RIGHT_PANEL_SELECTOR) !== null
      if (open && !button) {
        button = document.createElement('button')
        button.type = 'button'
        button.className = 'zn-panel-close'
        button.textContent = 'Done'
        button.addEventListener('click', () => {
          window.dispatchEvent(new Event('zen:close-right-panel'))
        })
        document.body.appendChild(button)
      } else if (!open && button) {
        button.remove()
        button = null
      }
    }
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(sync)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    sync()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(raf)
      button?.remove()
    }
  }, [])
}

/** Close the drawer whenever a note gets selected through any path (search,
 *  wikilinks, deep links) — at phone width it's navigation, not a pane. */
function useDrawerAutoClose(): void {
  useEffect(() => {
    if (!isPhoneWidth()) return
    let lastSelected = useStore.getState().selectedPath
    return useStore.subscribe(() => {
      const s = useStore.getState()
      if (s.selectedPath !== lastSelected) {
        lastSelected = s.selectedPath
        if (s.selectedPath) setDrawerOpen(false)
      }
    })
  }, [])
}

// ---------------------------------------------------------------------------
// Settings mobilizer — turns the desktop two-pane Settings dialog into a
// paged flow (section list → detail with a back button). The dialog is a CSS
// grid of <aside> (nav) + content; mobile.css shows one pane at a time based
// on data-zn-view, and this hook drives the attribute + injects the back
// button. Desktop-only sections (MCP, CLI) are hidden by label.
// ---------------------------------------------------------------------------

// MCP/CLI are desktop-only integrations; Keymap records hardware keyboard
// shortcuts, which has no meaning on a soft keyboard (iPad keeps it — hardware
// keyboards are common there and the desktop settings layout applies ≥768px).
const HIDDEN_SETTINGS_SECTIONS = new Set(['MCP', 'CLI', 'Keymap'])

/** Sub-tabs that are desktop features: 'Search' (ripgrep/fzf binaries don't
 *  exist on iOS) and 'Quick capture' (its only content is the system-wide
 *  hotkey recorder — no iOS equivalent) at any width; 'Vim' (soft keyboards
 *  can't do modal editing) and 'Folders' (renaming system folders — the
 *  Vault sub-tab titled 'System' before the 2.13 settings reorg) on phones;
 *  iPads keep those two. */
function hiddenSubTabTitles(): Set<string> {
  return isPhoneWidth()
    ? new Set(['Search', 'Vim', 'Folders', 'Quick capture'])
    : new Set(['Search', 'Quick capture'])
}

/**
 * Content cleanups that must re-apply as the panel re-renders (switching
 * categories/sub-tabs): hide desktop-only sub-tabs (clicking a visible
 * sibling when the hidden one is active) and the custom-theme authoring
 * block (themes are ~/.config folders — a desktop workflow).
 */
function cleanSettingsContent(panel: HTMLElement): void {
  const hidden = hiddenSubTabTitles()
  const tabs = [...panel.querySelectorAll<HTMLElement>('[role="tab"]')]
  for (const tab of tabs) {
    const title = (tab.textContent ?? '').trim()
    if (!hidden.has(title)) continue
    tab.classList.add('zn-settings-hidden')
    if (tab.getAttribute('aria-selected') === 'true') {
      const fallback = tabs.find(
        (t) => t !== tab && !hidden.has((t.textContent ?? '').trim())
      )
      fallback?.click()
    }
  }
  for (const btn of panel.querySelectorAll<HTMLElement>('button')) {
    const label = (btn.textContent ?? '').trim()
    // Theme authoring and CSS override folders are desktop-filesystem
    // concepts — hide their whole blocks.
    if (label === 'New theme' || label === 'Open overrides folder') {
      const block = btn.closest<HTMLElement>('div.mb-2')?.parentElement
      block?.classList.add('zn-settings-hidden')
    }
  }
}

function mobilizeSettingsPanel(panel: HTMLElement): void {
  if (panel.dataset.znSettings === 'true') return
  panel.dataset.znSettings = 'true'

  // Device-level cleanups (phone AND iPad), re-applied on every re-render.
  cleanSettingsContent(panel)
  let raf = 0
  const contentObserver = new MutationObserver(() => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => cleanSettingsContent(panel))
  })
  contentObserver.observe(panel, { childList: true, subtree: true })

  // Everything below is the phone-only paged treatment.
  if (!isPhoneWidth()) return
  panel.dataset.znView = 'nav'

  const aside = panel.querySelector('aside')
  if (!aside) return

  // Hide desktop-only nav entries (matched by their visible label). Category
  // buttons are plain buttons in the scrollable list — not inside <nav>,
  // which only wraps search results.
  for (const btn of aside.querySelectorAll<HTMLElement>('button')) {
    const label = (btn.textContent ?? '').trim()
    if (HIDDEN_SETTINGS_SECTIONS.has(label)) btn.classList.add('zn-settings-hidden')
  }

  // Any tap on a category row (or a search result) advances to the detail
  // page. Category rows live in `.space-y-0.5` groups; search results in nav.
  aside.addEventListener(
    'click',
    (e) => {
      const target = e.target as HTMLElement
      if (target.closest('[class*="space-y-0.5"] button') || target.closest('nav button')) {
        panel.dataset.znView = 'detail'
      }
    },
    true
  )

  // Injected iOS-style back affordance for the detail page.
  const back = document.createElement('button')
  back.type = 'button'
  back.className = 'zn-settings-back'
  back.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 5l-7 7 7 7"/></svg>Settings'
  back.addEventListener('click', () => {
    panel.dataset.znView = 'nav'
  })
  panel.appendChild(back)

  // The desktop dialog closes via backdrop click; full-screen has no visible
  // backdrop, so the section list gets an explicit Done.
  const done = document.createElement('button')
  done.type = 'button'
  done.className = 'zn-settings-done'
  done.textContent = 'Done'
  done.addEventListener('click', () => {
    useStore.getState().setSettingsOpen(false)
  })
  panel.appendChild(done)
}

function useSettingsMobilizer(): void {
  useEffect(() => {
    // Runs at every width: device-level cleanups apply on iPad too; the
    // paged-navigation treatment inside is phone-gated.
    let raf = 0
    const scan = (attempt: number): void => {
      // The Settings dialog is the only z-modal panel using a two-column grid;
      // it's portaled to document.body, so a global query finds it.
      const panel = document.querySelector<HTMLElement>('.z-modal > div[class*="grid-cols-"]')
      if (panel) {
        mobilizeSettingsPanel(panel)
        return
      }
      if (attempt < 30) raf = requestAnimationFrame(() => scan(attempt + 1))
    }
    const unsub = useStore.subscribe(() => {
      if (useStore.getState().settingsOpen) {
        cancelAnimationFrame(raf)
        scan(0)
      }
    })
    return () => {
      unsub()
      cancelAnimationFrame(raf)
    }
  }, [])
}

/**
 * Palettes (notes search / commands / templates) render full-screen on phones
 * (mobile.css) — with no visible backdrop left to tap, inject a Cancel button
 * next to the input. Escape is dispatched at window level, where every
 * ModalRoot binds its close handler.
 */
function useMobilePaletteCancel(): void {
  useEffect(() => {
    if (!isPhoneWidth()) return
    let raf = 0
    const apply = (): void => {
      for (const dialog of document.querySelectorAll<HTMLElement>('.z-palette [role="dialog"]')) {
        if (dialog.querySelector('.zn-palette-cancel')) continue
        const input = dialog.querySelector('input')
        if (!input) continue
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'zn-palette-cancel'
        btn.textContent = 'Cancel'
        btn.addEventListener('click', () => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        })
        input.insertAdjacentElement('afterend', btn)
      }
    }
    const schedule = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(apply)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    schedule()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])
}

function MobileShellRoot(): React.JSX.Element {
  usePhoneLayoutBoot()
  useDrawerAutoClose()
  useSettingsMobilizer()
  useWikilinkTapNavigation()
  useBreadcrumbDrawerNav()
  useLongPressContextMenu()
  usePlaceholderCleanup()
  useEdgeSwipeDrawer()
  useRightPanelCloseButton()
  useCalendarWeekMode()
  useDesktopCommandCleanup()
  useMobilePaletteCancel()
  return (
    <>
      <MobileNav />
      <MobileDrawer />
      <MobileEditorToolbar />
    </>
  )
}

export function mountMobileShell(): void {
  document.documentElement.classList.add('zn-mobile')
  const host = document.createElement('div')
  host.id = 'zn-mobile-shell'
  document.body.appendChild(host)
  ReactDOM.createRoot(host).render(
    <React.StrictMode>
      <MobileShellRoot />
    </React.StrictMode>
  )
}
