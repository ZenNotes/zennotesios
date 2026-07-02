/**
 * The phone navigation drawer — a purpose-built mobile surface that REPLACES
 * app-core's desktop sidebar below 768px (which is hidden by CSS). Flat,
 * iOS-style rows over the same Zustand store: search, the vault's main
 * destinations, and a drill-down folder browser. No trees, no chevron
 * forests, no icon clusters.
 */
import React, { useMemo, useRef, useState } from 'react'
import { useStore } from '@zennotes/app-core/store'
import { confirmApp } from '@zennotes/app-core/lib/confirm-requests'
import {
  csvPathForFormDir,
  databaseTabPath,
  FORM_DIR_SUFFIX,
  isFormDirName
} from '@zennotes/shared-domain/databases'
import { setDrawerOpen, useDrawerOpen } from './drawer-state'

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
  help: 'M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 100-20 10 10 0 000 20z',
  calendar:
    'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
  database:
    'M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3zM3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3'
}

/** A note's path relative to the primary notes area. */
function inboxSubpath(path: string, primaryAtRoot: boolean): string {
  if (primaryAtRoot) return path
  return path.startsWith('inbox/') ? path.slice(6) : path
}

function dirOf(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx === -1 ? '' : p.slice(0, idx)
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
  const dateDirs = useMemo(() => {
    const dirs = new Set<string>()
    if (dailyDir) dirs.add(dailyDir)
    if (weeklyDir) dirs.add(weeklyDir)
    return dirs
  }, [dailyDir, weeklyDir])
  const [path, setPath] = useState('')

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
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return {
      childFolders: [...folderSet.entries()].sort((a, b) => a[1].localeCompare(b[1])),
      childDatabases: databases.sort((a, b) => a[1].localeCompare(b[1])),
      childNotes: noteRows
    }
  }, [notes, folders, path, primaryAtRoot])

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
    <MobileDrawerBody
      vaultName={vaultName}
      dailyDir={dailyDir}
      weeklyDir={weeklyDir}
      dateDirs={dateDirs}
      path={path}
      setPath={setPath}
      childFolders={childFolders}
      childDatabases={childDatabases}
      childNotes={childNotes}
      close={close}
      go={go}
      s={s}
    />
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
  dailyDir: string | null
  weeklyDir: string | null
  dateDirs: Set<string>
  path: string
  setPath: (p: string) => void
  childFolders: Array<[string, string]>
  childDatabases: Array<[string, string, string]>
  childNotes: Array<{ path: string; title: string }>
  close: () => void
  go: (action: () => unknown) => void
  s: () => ReturnType<typeof useStore.getState>
}): React.JSX.Element {
  const {
    vaultName,
    dailyDir,
    weeklyDir,
    dateDirs,
    path,
    setPath,
    childFolders,
    childDatabases,
    childNotes,
    close,
    go,
    s
  } = props
  const lp = useLongPress()

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
        <div className="zn-mobile-drawer-header">{vaultName}</div>

        <button type="button" className="zn-mobile-drawer-search" onClick={() => go(() => s().setSearchOpen(true))}>
          <Icon d={D.search} />
          Search notes
        </button>

        <div className="zn-mobile-drawer-scroll">
          {path === '' ? (
            <div className="zn-mobile-drawer-group">
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
              <button type="button" onClick={() => go(() => s().openTagView(''))}>
                <Icon d={D.tag} />
                Tags
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
            {path === '' ? 'Notes' : (path.split('/').pop() ?? path)}
          </div>
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
          <button type="button" onClick={() => go(() => s().openHelpView())}>
            <Icon d={D.help} />
            Help
          </button>
          <button type="button" onClick={() => go(() => s().setSettingsOpen(true))}>
            <Icon d={D.settings} />
            Settings
          </button>
        </div>
      </nav>
    </>
  )
}
