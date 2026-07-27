/**
 * The phone navigation drawer — a purpose-built mobile surface that REPLACES
 * app-core's desktop sidebar below 768px (which is hidden by CSS). Flat,
 * iOS-style rows over the same Zustand store: search, the vault's main
 * destinations, and a drill-down folder browser. No trees, no chevron
 * forests, no icon clusters.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@zennotes/app-core/store'
import type { NoteSortOrder } from '@zennotes/app-core/store'
import { naturalCompare } from '@zennotes/app-core/lib/natural-sort'
import { confirmApp } from '@zennotes/app-core/lib/confirm-requests'
import {
  csvPathForFormDir,
  databaseTabPath,
  FORM_DIR_SUFFIX,
  isFormDirName
} from '@zennotes/shared-domain/databases'
import { setDrawerOpen, takeDrawerPath, useDrawerOpen } from './drawer-state'
import { openMobileSheet } from './sheet-state'
import { goHome } from './nav'
import { promptApp } from '@zennotes/app-core/lib/prompt-requests'
import {
  ICLOUD_VAULT_ROOT_PREFIX,
  VAULT_ROOT_PREFIX,
  listSwitchableVaults,
  type MobileVaultEntry
} from '../bridge/mobile-bridge'
import { sanitizeNoteTitle } from '../bridge/vault-core'

function Icon({ d }: { d: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

const D = {
  search: 'M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z',
  home: 'M3 10.5L12 3l9 7.5M5.5 9v11h13V9',
  tasks: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11',
  quick: 'M13 2L4.5 12.5H11L10 22l8.5-10.5H12L13 2',
  tag: 'M20 10l-8.5 8.5a2 2 0 01-2.83 0L3 12.83V5a2 2 0 012-2h7.83L20 10zM7.5 7.5h.01',
  archive: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  trash: 'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
  note: 'M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6zM14 3v6h6',
  back: 'M14.5 5l-7 7 7 7',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
  calendar:
    'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
  database:
    'M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3zM3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3',
  sort: 'M4 6h16M4 12h10M4 18h5',
  check: 'M20 6L9 17l-5-5',
  files:
    'M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 21',
  cloud: 'M17.5 19a4.5 4.5 0 001.03-8.88 6 6 0 00-11.77 1.13A3.75 3.75 0 007.25 19h10.25z',
  server:
    'M4 4h16a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1zM4 14h16a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1v-4a1 1 0 011-1zM7 7h.01M7 17h.01',
  phone:
    'M8 2h8a2 2 0 012 2v16a2 2 0 01-2 2H8a2 2 0 01-2-2V4a2 2 0 012-2zM12 18h.01',
  plus: 'M12 5v14M5 12h14',
  chevDown: 'M6 9l6 6 6-6'
}

/** A note's path relative to the primary notes area. */
function inboxSubpath(path: string, primaryAtRoot: boolean): string {
  if (primaryAtRoot) return path
  return path.startsWith('inbox/') ? path.slice(6) : path
}

type SortableNote = { title: string; updatedAt: number; createdAt: number }

/** The drawer's note order, mirroring desktop's shared `noteSortOrder` pref so
 *  the two stay consistent. 'none'/'manual' (a desktop drag order the drawer
 *  can't reproduce) fall back to most-recently-edited. */
function noteComparator(order: NoteSortOrder): (a: SortableNote, b: SortableNote) => number {
  switch (order) {
    case 'name-asc':
      return (a, b) => naturalCompare(a.title, b.title)
    case 'name-desc':
      return (a, b) => naturalCompare(b.title, a.title)
    case 'updated-asc':
      return (a, b) => a.updatedAt - b.updatedAt
    case 'created-desc':
      return (a, b) => b.createdAt - a.createdAt
    case 'created-asc':
      return (a, b) => a.createdAt - b.createdAt
    default:
      return (a, b) => b.updatedAt - a.updatedAt
  }
}

const SORT_OPTIONS: Array<[NoteSortOrder, string]> = [
  ['name-asc', 'Name (A–Z)'],
  ['name-desc', 'Name (Z–A)'],
  ['updated-desc', 'Recently edited'],
  ['updated-asc', 'Oldest edited'],
  ['created-desc', 'Recently created'],
  ['created-asc', 'Oldest created']
]

function dirOf(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx === -1 ? '' : p.slice(0, idx)
}

/**
 * Vault switcher (tap the drawer's vault name). One-tap rows for every vault
 * the phone can reach — on-device folders, every vault in the iCloud
 * container, and saved remote servers — plus "New Vault…", which creates a
 * vault in the current storage tier. Switching routes through the store's
 * openLocalVault / connectRemoteWorkspaceProfile actions so the workspace
 * resets the same way the desktop switcher does.
 */
export function VaultsSheet({ onClose }: { onClose: () => void }): React.JSX.Element {
  const currentName = useStore((s) => s.vault?.name ?? null)
  const currentRoot = useStore((s) => s.vault?.root ?? '')
  const workspaceMode = useStore((s) => s.workspaceMode)
  const remoteProfileId = useStore((s) => s.remoteWorkspaceInfo?.profileId ?? null)
  const remoteProfiles = useStore((s) => s.remoteWorkspaceProfiles)
  const [entries, setEntries] = useState<MobileVaultEntry[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    void listSwitchableVaults()
      .then((v) => alive && setEntries(v))
      .catch(() => alive && setEntries([]))
    void useStore.getState().refreshRemoteWorkspaceProfiles()
    return () => {
      alive = false
    }
  }, [])

  // The store's vault.root on mobile is the friendly location string, which
  // conveniently names the tier ("On My iPhone › …" / "iCloud Drive › …").
  const currentTier =
    workspaceMode === 'remote' ? 'remote' : currentRoot.startsWith('iCloud') ? 'icloud' : 'local'
  const isCurrent = (e: MobileVaultEntry): boolean =>
    currentTier === e.tier && e.name === currentName

  const act = (key: string, fn: () => Promise<unknown>): void => {
    setBusy(key)
    setError('')
    void fn()
      .then(() => {
        onClose()
        setDrawerOpen(false)
      })
      .catch((err) => {
        setError(String((err as Error)?.message ?? err))
        setBusy(null)
      })
  }

  const createVault = (): void => {
    const tier = currentTier === 'icloud' ? 'icloud' : 'local'
    onClose()
    // Let the sheet unmount so the prompt gets focus.
    window.setTimeout(() => {
      void (async () => {
        const name = await promptApp({
          title: 'New Vault',
          description:
            tier === 'icloud' ? 'Created in iCloud Drive › ZenNotes.' : 'Created on this iPhone.',
          placeholder: 'Vault name',
          okLabel: 'Create'
        })
        const clean = sanitizeNoteTitle(name?.trim() ?? '')
        if (!clean) return
        const root =
          tier === 'icloud'
            ? `${ICLOUD_VAULT_ROOT_PREFIX}${encodeURIComponent(clean)}`
            : `${VAULT_ROOT_PREFIX}${clean}`
        await useStore.getState().openLocalVault(root)
        setDrawerOpen(false)
      })()
    }, 30)
  }

  return (
    <>
      <div className="zn-mobile-sheet-backdrop" onClick={onClose} role="presentation" />
      <div className="zn-mobile-sheet" role="dialog" aria-label="Vaults">
        <div className="zn-mobile-sheet-title">Vaults</div>
        <div className="zn-mobile-sheet-scroll">
          {busy !== null && <p className="zn-mobile-sheet-note">Opening…</p>}
          {error && <p className="zn-mobile-sheet-note zn-danger">{error}</p>}
          {busy === null && entries === null && (
            <p className="zn-mobile-sheet-note">Looking for vaults…</p>
          )}
          {busy === null && entries !== null && (
            <div className="zn-mobile-sheet-group">
              {entries.map((entry) => {
                const current = isCurrent(entry)
                return (
                  <button
                    key={entry.root}
                    type="button"
                    className="zn-mobile-sheet-row"
                    disabled={current}
                    onClick={() => {
                      if (current) return
                      act(entry.root, () => useStore.getState().openLocalVault(entry.root))
                    }}
                  >
                    <Icon d={entry.tier === 'icloud' ? D.cloud : D.phone} />
                    <span className="zn-truncate">{entry.name}</span>
                    <span className="zn-mobile-sheet-row-detail">
                      {current
                        ? 'Current'
                        : entry.tier === 'icloud'
                          ? 'iCloud Drive'
                          : 'On My iPhone'}
                    </span>
                  </button>
                )
              })}
              {remoteProfiles.map((profile) => {
                const current = workspaceMode === 'remote' && profile.id === remoteProfileId
                return (
                  <button
                    key={profile.id}
                    type="button"
                    className="zn-mobile-sheet-row"
                    disabled={current}
                    onClick={() => {
                      if (current) return
                      act(profile.id, () =>
                        useStore.getState().connectRemoteWorkspaceProfile(profile.id)
                      )
                    }}
                  >
                    <Icon d={D.server} />
                    <span className="zn-truncate">
                      {profile.name.replace(` (${profile.baseUrl.replace(/^https?:\/\//, '')})`, '').trim() ||
                        profile.name}
                    </span>
                    <span className="zn-mobile-sheet-row-detail">
                      {current ? 'Connected' : profile.baseUrl.replace(/^https?:\/\//, '')}
                    </span>
                  </button>
                )
              })}
              <button type="button" className="zn-mobile-sheet-row" onClick={createVault}>
                <Icon d={D.plus} />
                New Vault…
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export function MobileDrawer(): React.JSX.Element | null {
  const open = useDrawerOpen()
  const vaultName = useStore((s) => s.vault?.name ?? 'ZenNotes')
  const notes = useStore((s) => s.notes)
  const folders = useStore((s) => s.folders)
  const primaryAtRoot = useStore((s) => s.vaultSettings.primaryNotesLocation === 'root')
  // Primitive selectors only — returning a fresh object from a selector
  // re-renders forever (Object.is on a new Set is never equal).
  const dailyDir = useStore((s) =>
    s.vaultSettings.dailyNotes.enabled ? s.vaultSettings.dailyNotes.directory : null
  )
  const weeklyDir = useStore((s) =>
    s.vaultSettings.weeklyNotes.enabled ? s.vaultSettings.weeklyNotes.directory : null
  )
  const monthlyDir = useStore((s) =>
    s.vaultSettings.monthlyNotes.enabled ? s.vaultSettings.monthlyNotes.directory : null
  )
  const noteSortOrder = useStore((s) => s.noteSortOrder)
  const dateDirs = useMemo(() => {
    const dirs = new Set<string>()
    if (dailyDir) dirs.add(dailyDir)
    if (weeklyDir) dirs.add(weeklyDir)
    if (monthlyDir) dirs.add(monthlyDir)
    return dirs
  }, [dailyDir, weeklyDir, monthlyDir])
  const [path, setPath] = useState('')

  // On each open, jump to the folder a breadcrumb tap requested ('' for a
  // plain FAB/edge-swipe open). Consumed so it doesn't leak into later opens.
  useEffect(() => {
    if (open) setPath(takeDrawerPath())
  }, [open])

  const { childFolders, childDatabases, childNotes } = useMemo(() => {
    const folderSet = new Map<string, string>()
    const databases: Array<[string, string, string]> = []
    for (const f of folders) {
      if (f.folder !== 'inbox') continue
      if (dirOf(f.subpath) !== path) continue
      const name = f.subpath.split('/').pop() ?? f.subpath
      if (isFormDirName(name)) {
        // Databases are `.base` folders — surface them as openable rows.
        const vaultRel = primaryAtRoot ? f.subpath : `inbox/${f.subpath}`
        databases.push([
          databaseTabPath(csvPathForFormDir(vaultRel)),
          name.slice(0, -FORM_DIR_SUFFIX.length),
          f.subpath
        ])
        continue
      }
      folderSet.set(f.subpath, name)
    }
    const noteRows = notes
      .filter((n) => {
        if (n.folder !== 'inbox') return false
        const sub = inboxSubpath(n.path, primaryAtRoot)
        return dirOf(sub) === path && !isFormDirName(dirOf(sub).split('/').pop() ?? '')
      })
      .sort(noteComparator(noteSortOrder))
    return {
      childFolders: [...folderSet.entries()].sort((a, b) => a[1].localeCompare(b[1])),
      childDatabases: databases.sort((a, b) => a[1].localeCompare(b[1])),
      childNotes: noteRows
    }
  }, [notes, folders, path, primaryAtRoot, noteSortOrder])

  if (!open) return null

  const close = (): void => {
    setDrawerOpen(false)
    setPath('')
  }

  const go = (action: () => unknown): void => {
    close()
    window.setTimeout(() => void action(), 30)
  }

  const s = (): ReturnType<typeof useStore.getState> => useStore.getState()

  return (
    <>
    <MobileDrawerBody
      vaultName={vaultName}
      dailyDir={dailyDir}
      weeklyDir={weeklyDir}
      monthlyDir={monthlyDir}
      dateDirs={dateDirs}
      path={path}
      setPath={setPath}
      childFolders={childFolders}
      childDatabases={childDatabases}
      childNotes={childNotes}
      noteSortOrder={noteSortOrder}
      close={close}
      go={go}
      s={s}
      onOpenVaults={() => openMobileSheet('vaults')}
    />
    </>
  )
}

/** Long-press (500ms) handler props for destructive row actions. Pointer
 *  events cover both real touches and simulated mouse input; a 12px movement
 *  threshold keeps scrolling from triggering it. */
function useLongPress(): (fn: () => void) => {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onClickCapture: (e: React.MouseEvent) => void
} {
  const timer = useRef<number | null>(null)
  const fired = useRef(false)
  const start = useRef({ x: 0, y: 0 })
  const clear = (): void => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
  }
  return (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false
      start.current = { x: e.clientX, y: e.clientY }
      clear()
      timer.current = window.setTimeout(() => {
        fired.current = true
        fn()
      }, 500)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!timer.current) return
      const dx = e.clientX - start.current.x
      const dy = e.clientY - start.current.y
      if (dx * dx + dy * dy > 144) clear()
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
    },
    onClickCapture: (e: React.MouseEvent) => {
      // Swallow the tap that ends a long-press.
      if (fired.current) {
        e.preventDefault()
        e.stopPropagation()
        fired.current = false
      }
    }
  })
}

function MobileDrawerBody(props: {
  vaultName: string
  onOpenVaults: () => void
  dailyDir: string | null
  weeklyDir: string | null
  monthlyDir: string | null
  dateDirs: Set<string>
  path: string
  setPath: (p: string) => void
  childFolders: Array<[string, string]>
  childDatabases: Array<[string, string, string]>
  childNotes: Array<{ path: string; title: string }>
  noteSortOrder: NoteSortOrder
  close: () => void
  go: (action: () => unknown) => void
  s: () => ReturnType<typeof useStore.getState>
}): React.JSX.Element {
  const {
    vaultName,
    dailyDir,
    weeklyDir,
    monthlyDir,
    dateDirs,
    path,
    setPath,
    childFolders,
    childDatabases,
    childNotes,
    noteSortOrder,
    close,
    go,
    s
  } = props
  const lp = useLongPress()
  const [sortOpen, setSortOpen] = useState(false)

  const trashNote = (notePath: string, title: string): void => {
    void (async () => {
      const ok = await confirmApp({
        title: `Delete "${title}"?`,
        description: 'It will move to the trash.',
        confirmLabel: 'Delete',
        danger: true
      })
      if (ok) await window.zen.moveToTrash(notePath)
    })()
  }

  const deleteDatabase = (subpath: string, title: string): void => {
    void (async () => {
      const ok = await confirmApp({
        title: `Delete "${title}"?`,
        description: 'All records will be permanently deleted. This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true
      })
      if (ok) await s().deleteFolder('inbox', subpath)
    })()
  }

  const deleteFolder = (subpath: string, name: string): void => {
    void (async () => {
      const ok = await confirmApp({
        title: `Delete "${name}"?`,
        description: 'Everything inside will be permanently deleted. This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true
      })
      if (ok) await s().deleteFolder('inbox', subpath)
    })()
  }

  return (
    <>
      <div className="zn-mobile-backdrop" onClick={close} role="presentation" />
      <nav className="zn-mobile-drawer" aria-label="Vault navigation">
        <button
          type="button"
          className="zn-mobile-drawer-header"
          aria-label="Switch vault"
          onClick={props.onOpenVaults}
        >
          <span className="zn-truncate">{vaultName}</span>
          <span className="zn-mobile-drawer-header-chev">
            <Icon d={D.chevDown} />
          </span>
        </button>

        <button type="button" className="zn-mobile-drawer-search" onClick={() => go(() => s().setSearchOpen(true))}>
          <Icon d={D.search} />
          Search notes
        </button>

        <div className="zn-mobile-drawer-scroll">
          {path === '' ? (
            <div className="zn-mobile-drawer-group">
              {/* Views like Tasks/Tags have no back chevron (that's a note-header
                  affordance), so the drawer is the guaranteed way Home. */}
              <button type="button" onClick={() => go(() => goHome())}>
                <Icon d={D.home} />
                Home
              </button>
              <button type="button" onClick={() => go(() => s().openTasksView())}>
                <Icon d={D.tasks} />
                Tasks
              </button>
              <button type="button" onClick={() => go(() => s().openQuickNotesView())}>
                <Icon d={D.quick} />
                Quick Notes
              </button>
              {dailyDir && (
                <button type="button" onClick={() => setPath(dailyDir)}>
                  <Icon d={D.calendar} />
                  <span className="zn-truncate">Daily Notes</span>
                  <span className="zn-mobile-drawer-chevron">›</span>
                </button>
              )}
              {weeklyDir && (
                <button type="button" onClick={() => setPath(weeklyDir)}>
                  <Icon d={D.calendar} />
                  <span className="zn-truncate">Weekly Notes</span>
                  <span className="zn-mobile-drawer-chevron">›</span>
                </button>
              )}
              {monthlyDir && (
                <button type="button" onClick={() => setPath(monthlyDir)}>
                  <Icon d={D.calendar} />
                  <span className="zn-truncate">Monthly Notes</span>
                  <span className="zn-mobile-drawer-chevron">›</span>
                </button>
              )}
              <button type="button" onClick={() => go(() => s().openTagView(''))}>
                <Icon d={D.tag} />
                Tags
              </button>
              {/* The assets table only exists as a pane tab (zen://assets) —
                  the palette's "Go to Files" drives the desktop sidebar list,
                  which phones don't render, so this row is the phone's way in. */}
              <button type="button" onClick={() => go(() => s().openAssetsView())}>
                <Icon d={D.files} />
                Files
              </button>
              <button type="button" onClick={() => go(() => s().openArchiveView())}>
                <Icon d={D.archive} />
                Archive
              </button>
              <button type="button" onClick={() => go(() => s().openTrashView())}>
                <Icon d={D.trash} />
                Trash
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="zn-mobile-drawer-back"
              onClick={() => setPath(dirOf(path))}
            >
              <Icon d={D.back} />
              {dirOf(path) === '' ? 'All notes' : (dirOf(path).split('/').pop() ?? '')}
            </button>
          )}

          <div className="zn-mobile-drawer-section">
            <span className="zn-truncate">
              {path === '' ? 'Notes' : (path.split('/').pop() ?? path)}
            </span>
            <button
              type="button"
              className={`zn-mobile-drawer-sort${sortOpen ? ' is-open' : ''}`}
              aria-label="Sort notes"
              aria-expanded={sortOpen}
              onClick={() => setSortOpen((v) => !v)}
            >
              <Icon d={D.sort} />
            </button>
          </div>
          {sortOpen && (
            <div className="zn-mobile-drawer-sortmenu" role="menu" aria-label="Sort order">
              {SORT_OPTIONS.map(([order, label]) => (
                <button
                  key={order}
                  type="button"
                  role="menuitemradio"
                  aria-checked={noteSortOrder === order}
                  className={noteSortOrder === order ? 'is-active' : ''}
                  onClick={() => {
                    s().setNoteSortOrder(order)
                    setSortOpen(false)
                  }}
                >
                  <span className="zn-truncate">{label}</span>
                  {noteSortOrder === order && <Icon d={D.check} />}
                </button>
              ))}
            </div>
          )}
          <div className="zn-mobile-drawer-group">
            {childFolders.map(([subpath, name]) => (
              <button
                key={subpath}
                type="button"
                onClick={() => setPath(subpath)}
                {...lp(() => deleteFolder(subpath, name))}
              >
                <Icon d={dateDirs.has(subpath) ? D.calendar : D.folder} />
                <span className="zn-truncate">{name}</span>
                <span className="zn-mobile-drawer-chevron">›</span>
              </button>
            ))}
            {childDatabases.map(([tabPath, title, subpath]) => (
              <button
                key={tabPath}
                type="button"
                onClick={() => go(() => s().selectNote(tabPath))}
                {...lp(() => deleteDatabase(subpath, title))}
              >
                <Icon d={D.database} />
                <span className="zn-truncate">{title}</span>
              </button>
            ))}
            {childNotes.map((n) => (
              <button
                key={n.path}
                type="button"
                onClick={() => go(() => s().selectNote(n.path))}
                {...lp(() => trashNote(n.path, n.title))}
              >
                <Icon d={D.note} />
                <span className="zn-truncate">{n.title}</span>
              </button>
            ))}
            {childFolders.length === 0 && childDatabases.length === 0 && childNotes.length === 0 && (
              <div className="zn-mobile-drawer-empty">No notes here yet</div>
            )}
          </div>
        </div>

        <div className="zn-mobile-drawer-footer">
          <button type="button" onClick={() => go(() => s().setSettingsOpen(true))}>
            <Icon d={D.settings} />
            Settings
          </button>
        </div>
      </nav>
    </>
  )
}
