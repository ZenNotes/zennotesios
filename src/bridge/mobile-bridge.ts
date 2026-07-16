/**
 * The mobile `window.zen` — third ZenBridge implementation (after Electron IPC
 * and the web HTTP bridge). Vault operations run against the on-device vault
 * (vault-fs.ts); desktop-only surfaces resolve to the same "unsupported"
 * states the web bridge uses so the shared UI hides those affordances.
 *
 * `runtime` reports `'web'`: the current bridge contract only knows
 * 'desktop' | 'web', and every desktop-only code path in app-core is gated on
 * `runtime === 'desktop'`, so 'web' + capability flags produces the correct
 * mobile behavior without modifying the zennotes repo.
 */
import { registerPlugin } from '@capacitor/core'
import { Clipboard } from '@capacitor/clipboard'
import {
  installZenBridge,
  type ZenAppInfo,
  type ZenBridge,
  type ZenCapabilities
} from '@zennotes/bridge-contract/bridge'
import type {
  AppUpdateState,
  AssetMeta,
  CliInstallStatus,
  DeletedAsset,
  DirectoryBrowseResult,
  ImportedAsset,
  LocalVaultEntry,
  NoteFolder,
  NoteMeta,
  RaycastExtensionStatus,
  ServerCapabilities,
  ServerSessionStatus,
  TikzRenderResponse,
  VaultInfo,
  VaultTextSearchBackendPreference,
  VaultTextSearchCapabilities,
  VaultTextSearchMatch
} from '@shared/ipc'
import {
  csvPathForFormDir,
  databaseSchemaPathFor,
  formDirFromCsvPath,
  formTitleFromCsvPath,
  FORM_DIR_SUFFIX,
  isFormDirName,
  type DatabaseDoc,
  type DatabaseSidecar,
  type DatabaseSummary,
  type DbField,
  type DbRow,
  type DbView
} from '@shared/databases'
import {
  buildDefaultViews,
  inferFields,
  parseCsv,
  parseRows,
  serializeRows
} from '@shared/database-csv'
import type {
  McpClientStatus,
  McpInstructionsPayload,
  McpServerRuntime
} from '@shared/mcp-clients'
import { MobileVault } from './vault-fs'
import { listVaultDirs } from './native-fs'
import { getStoragePref, setStoragePref, icloudStatus } from './icloud'
import { pickExternalVault, resolveExternalVault } from './folder-picker'
import { onVaultChange, onOpenNoteRequested, requestOpenNote } from './events'
import { joinPath, posixNormalize, sanitizeNoteTitle, toPosix } from './vault-core'

const APP_VERSION = '0.1.0'
const CURRENT_VAULT_KEY = 'zn-mobile:current-vault'
const DEFAULT_VAULT_NAME = 'My Vault'
const VAULT_ROOT_PREFIX = 'zn://vaults/'

const MOBILE_CAPABILITIES: ZenCapabilities = {
  supportsUpdater: false,
  supportsNativeMenus: false,
  supportsFloatingWindows: false,
  // Native UIDocumentPicker: open any Files-app folder as a vault (spec 03
  // external tier) — this is what makes "Choose Vault Folder" work.
  supportsLocalFilesystemPickers: true,
  supportsRemoteWorkspace: false,
  supportsCliInstall: false,
  supportsCustomTemplates: true
}

const MOBILE_APP_INFO: ZenAppInfo = {
  name: 'zennotes-iphone',
  productName: 'ZenNotes',
  version: APP_VERSION,
  description: 'ZenNotes for iPhone',
  homepage: 'https://zennotes.org',
  runtime: 'web'
}

let vault: MobileVault | null = null

function isPhoneViewport(): boolean {
  return window.innerWidth < 768
}

export function activeVault(): MobileVault {
  if (!vault) throw new Error('No vault is open')
  return vault
}

function vaultNameFromRoot(root: string): string {
  const raw = root.startsWith(VAULT_ROOT_PREFIX) ? root.slice(VAULT_ROOT_PREFIX.length) : root
  const name = decodeURIComponent(raw).split('/').filter(Boolean).pop() ?? ''
  return name || DEFAULT_VAULT_NAME
}

/** Human-readable location for the settings UI — where the vault actually
 *  lives, not an internal token. */
function friendlyVaultRoot(v: MobileVault): string {
  if (!v.fs.isCloud) return `On My iPhone › ZenNotes › ${v.name}`
  const uri = decodeURIComponent(v.fs.cloudRootUri ?? '')
  if (uri.includes('Mobile Documents/iCloud~md~zennotes')) {
    return `iCloud Drive › ZenNotes › ${v.name}`
  }
  const cloudDocs = uri.split('Mobile Documents/com~apple~CloudDocs/Documents/')[1]
  if (cloudDocs !== undefined) {
    return `iCloud Drive › ${cloudDocs.split('/').filter(Boolean).join(' › ') || v.name}`
  }
  return `Files › ${v.name}`
}

function currentVaultInfo(): VaultInfo | null {
  if (!vault) return null
  return { root: friendlyVaultRoot(vault), name: vault.name }
}

async function openVaultByName(name: string, cloudRootUri: string | null = null): Promise<VaultInfo> {
  const next = new MobileVault(name, cloudRootUri)
  await next.open()
  vault = next
  localStorage.setItem(CURRENT_VAULT_KEY, name)
  return currentVaultInfo() as VaultInfo
}

/**
 * First-run bootstrap: open the remembered vault, or create the default one
 * seeded with the official demo tour so the first launch lands in real
 * content (math, Mermaid, tasks) instead of an empty screen. When the
 * storage preference is iCloud (spec 03 tier), the vault lives in the
 * ubiquity container instead — falling back to local when iCloud is
 * unavailable (signed out) rather than blocking the app.
 */
export async function bootVault(): Promise<void> {
  const remembered = localStorage.getItem(CURRENT_VAULT_KEY)

  if (getStoragePref() === 'external') {
    const external = await resolveExternalVault()
    if (external) {
      await openVaultByName(external.name, external.url)
      return
    }
    console.warn('external vault bookmark could not be resolved — falling back to local storage')
    setStoragePref('local')
  }

  if (getStoragePref() === 'icloud') {
    const status = await icloudStatus()
    if (status.available && status.rootUrl) {
      const cloudVaults = status.vaults ?? []
      const name =
        remembered && cloudVaults.includes(remembered)
          ? remembered
          : (cloudVaults[0] ?? remembered ?? DEFAULT_VAULT_NAME)
      const fresh = !cloudVaults.includes(name)
      await openVaultByName(name, `${status.rootUrl}/${encodeURIComponent(name)}`)
      if (fresh) await activeVault().generateDemoTour()
      return
    }
    console.warn('iCloud vault preferred but unavailable — falling back to local storage')
  }

  const existing = await listVaultDirs()
  if (remembered && existing.some((v) => v.name === remembered)) {
    await openVaultByName(remembered)
    return
  }
  if (existing.length > 0) {
    await openVaultByName(existing[0]!.name)
    return
  }
  await openVaultByName(DEFAULT_VAULT_NAME)
  await activeVault().generateDemoTour()
}

// --------------------------------------------------------------------
// Share Extension inbox — captures written by the native extension into the
// App Group (ShareInboxPlugin.swift) become quick notes here, on launch and
// on every foreground.
// --------------------------------------------------------------------

interface ShareCapture {
  body?: string
  createdAt?: number
}

const ShareInbox = registerPlugin<{
  drain(): Promise<{ captures: ShareCapture[] }>
}>('ShareInbox')

/** Quick-capture title semantics (first usable line, 80 chars), with a
 *  friendlier hostname title when the capture is just a shared URL. */
function shareCaptureTitle(body: string): string | undefined {
  const line = (body.split('\n').find((l) => l.trim()) ?? '').trim()
  if (!line) return undefined
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(line)) {
    try {
      return new URL(line).host || undefined
    } catch {
      // fall through to text handling
    }
  }
  const heading = line.match(/^#{1,6}\s+(.+)$/u)
  const title = (heading ? heading[1]! : line.replace(/^[*\-+>\s]+/u, '')).trim().slice(0, 80)
  return title || undefined
}

export async function importPendingShares(): Promise<number> {
  if (!vault) return 0
  let captures: ShareCapture[] = []
  try {
    captures = (await ShareInbox.drain()).captures ?? []
  } catch {
    return 0 // plugin unavailable (e.g. browser dev)
  }
  let imported = 0
  for (const capture of captures) {
    const body = (capture.body ?? '').trim()
    if (!body) continue
    const meta = await activeVault().createNote('quick', shareCaptureTitle(body))
    await activeVault().writeNote(meta.path, `${body}\n`)
    imported++
  }
  return imported
}

// --------------------------------------------------------------------
// Databases — same shared CSV/schema logic the web bridge uses, over the
// local vault files (byte-identical on-disk format to desktop).
// --------------------------------------------------------------------

const SCHEMA_SAMPLE_ROWS = 50
const DB_TITLE_BAD = /[\\/:*?"<>|]/g

function dbGenId(): string {
  return crypto.randomUUID()
}

function dbTitleFromPath(csvPath: string): string {
  const posix = toPosix(csvPath)
  if (formDirFromCsvPath(posix)) return formTitleFromCsvPath(posix)
  const base = posix.split('/').filter(Boolean).pop() ?? csvPath
  return base.replace(/\.csv$/i, '')
}

async function readFileTextOrNull(relPath: string): Promise<string | null> {
  return await activeVault().fs.readTextOrNull(posixNormalize(relPath))
}

function dbNoteHasBody(text: string): boolean {
  let body = text
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(body)
  if (fm) body = body.slice(fm[0].length)
  body = body.replace(/^\s*#[^\n]*\r?\n?/, '')
  return body.trim().length > 0
}

function dbNormalizeSidecar(raw: unknown): DatabaseSidecar | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const fields = Array.isArray(obj.fields) ? (obj.fields as DbField[]) : null
  if (!fields || fields.length === 0) return null
  if (!fields.every((f) => f && typeof f.id === 'string' && typeof f.name === 'string')) return null
  const fieldIds = new Set(fields.map((f) => f.id))
  const idFieldId =
    typeof obj.idFieldId === 'string' && fieldIds.has(obj.idFieldId) ? obj.idFieldId : fields[0]!.id
  let views = Array.isArray(obj.views) ? (obj.views as DbView[]) : []
  views = views.filter(
    (v) => v && typeof v.id === 'string' && (v.type === 'table' || v.type === 'board')
  )
  if (views.length === 0) views = buildDefaultViews(fields).views
  const activeViewId =
    typeof obj.activeViewId === 'string' && views.some((v) => v.id === obj.activeViewId)
      ? obj.activeViewId
      : views[0]!.id
  const pages =
    obj.pages && typeof obj.pages === 'object'
      ? (Object.fromEntries(
          Object.entries(obj.pages as Record<string, unknown>).filter(
            ([, v]) => typeof v === 'string'
          )
        ) as Record<string, string>)
      : undefined
  return { version: 1, idFieldId, fields, views, activeViewId, ...(pages ? { pages } : {}) }
}

function dbPagesToFull(csvRel: string, pages: Record<string, string>): Record<string, string> {
  const formDir = formDirFromCsvPath(toPosix(csvRel))
  if (!formDir) return pages
  const prefix = `${formDir}/`
  return Object.fromEntries(
    Object.entries(pages).map(([id, p]) => [id, p.startsWith(prefix) ? p : `${prefix}${p}`])
  )
}

function dbPagesToRelative(csvRel: string, pages: Record<string, string>): Record<string, string> {
  const formDir = formDirFromCsvPath(toPosix(csvRel))
  if (!formDir) return pages
  const prefix = `${formDir}/`
  return Object.fromEntries(
    Object.entries(pages).map(([id, p]) => [id, p.startsWith(prefix) ? p.slice(prefix.length) : p])
  )
}

function dbHydrate(
  csvPath: string,
  sidecar: DatabaseSidecar,
  rows: DbRow[],
  pageHasContent?: Record<string, boolean>
): DatabaseDoc {
  return {
    ...sidecar,
    path: toPosix(csvPath),
    title: dbTitleFromPath(csvPath),
    rows,
    ...(pageHasContent ? { pageHasContent } : {})
  }
}

async function dbReadSidecar(csvPath: string): Promise<DatabaseSidecar | null> {
  const schemaPath = databaseSchemaPathFor(toPosix(csvPath))
  if (!schemaPath) return null
  const raw = await readFileTextOrNull(schemaPath)
  if (raw === null) return null
  let sidecar: DatabaseSidecar | null
  try {
    sidecar = dbNormalizeSidecar(JSON.parse(raw))
  } catch {
    return null
  }
  if (sidecar?.pages) sidecar.pages = dbPagesToFull(toPosix(csvPath), sidecar.pages)
  return sidecar
}

async function dbPersistSidecar(csvPath: string, sidecar: DatabaseSidecar): Promise<void> {
  const schemaPath = databaseSchemaPathFor(toPosix(csvPath))
  if (!schemaPath) throw new Error(`Not a database folder: ${csvPath}`)
  const onDisk: DatabaseSidecar = sidecar.pages
    ? { ...sidecar, pages: dbPagesToRelative(toPosix(csvPath), sidecar.pages) }
    : sidecar
  await activeVault().writeNote(schemaPath, `${JSON.stringify(onDisk, null, 2)}\n`)
}

async function dbReadPageFlags(
  pages?: Record<string, string>
): Promise<Record<string, boolean> | undefined> {
  if (!pages || Object.keys(pages).length === 0) return undefined
  const flags: Record<string, boolean> = {}
  await Promise.all(
    Object.entries(pages).map(async ([rowId, notePath]) => {
      const text = await readFileTextOrNull(notePath)
      if (text !== null) flags[rowId] = dbNoteHasBody(text)
    })
  )
  return flags
}

async function primaryNotesAtRoot(): Promise<boolean> {
  try {
    return (await activeVault().getVaultSettings()).primaryNotesLocation === 'root'
  } catch {
    return false
  }
}

function vaultRelDir(folder: NoteFolder, subpath: string, atRoot: boolean): string {
  const sub = (subpath ?? '').replace(/^\/+|\/+$/g, '')
  if (folder === 'inbox') return atRoot ? sub : joinPath('inbox', sub)
  return joinPath(folder, sub)
}

function splitVaultPath(rel: string, atRoot: boolean): { folder: NoteFolder; subpath: string } {
  const parts = toPosix(rel).split('/').filter(Boolean)
  const top = parts[0]
  if (top === 'quick' || top === 'archive' || top === 'trash') {
    return { folder: top as NoteFolder, subpath: parts.slice(1).join('/') }
  }
  if (top === 'inbox' && !atRoot) {
    return { folder: 'inbox', subpath: parts.slice(1).join('/') }
  }
  return { folder: 'inbox', subpath: parts.join('/') }
}

async function openDatabase(csvPath: string): Promise<DatabaseDoc> {
  const rel = toPosix(csvPath)
  const csvText = await readFileTextOrNull(rel)
  if (csvText === null) throw new Error(`Database not found: ${rel}`)

  const existing = await dbReadSidecar(rel)
  if (existing) {
    const rows = parseRows(csvText, existing.fields, existing.idFieldId, dbGenId)
    const pageHasContent = await dbReadPageFlags(existing.pages)
    return dbHydrate(rel, existing, rows, pageHasContent)
  }

  const grid = parseCsv(csvText)
  const headers = grid[0] ?? []
  const { fields, idFieldId } = inferFields(headers, grid.slice(1, 1 + SCHEMA_SAMPLE_ROWS), dbGenId)
  const { views, activeViewId } = buildDefaultViews(fields, dbGenId)
  const sidecar: DatabaseSidecar = { version: 1, idFieldId, fields, views, activeViewId }
  const rows = parseRows(csvText, fields, idFieldId, dbGenId)
  await dbPersistSidecar(rel, sidecar)
  await activeVault().writeNote(rel, serializeRows(rows, fields))
  return dbHydrate(rel, sidecar, rows)
}

async function writeDatabaseRows(csvPath: string, rows: DbRow[]): Promise<DatabaseDoc> {
  const rel = toPosix(csvPath)
  const sidecar = await dbReadSidecar(rel)
  if (!sidecar) throw new Error(`Database sidecar missing: ${rel}`)
  await activeVault().writeNote(rel, serializeRows(rows, sidecar.fields))
  return dbHydrate(rel, sidecar, rows.map((r) => ({ ...r })))
}

async function writeDatabaseSchema(
  csvPath: string,
  sidecar: DatabaseSidecar,
  rows: DbRow[]
): Promise<DatabaseDoc> {
  const rel = toPosix(csvPath)
  const normalized = dbNormalizeSidecar(sidecar)
  if (!normalized) throw new Error(`Invalid database schema: ${rel}`)
  await dbPersistSidecar(rel, normalized)
  await activeVault().writeNote(rel, serializeRows(rows, normalized.fields))
  return dbHydrate(rel, normalized, rows.map((r) => ({ ...r })))
}

async function createDatabase(
  folder: NoteFolder,
  subpath: string,
  title?: string
): Promise<DatabaseDoc> {
  const atRoot = await primaryNotesAtRoot()
  const baseTitle = (title ?? 'Untitled Database').trim() || 'Untitled Database'
  const baseName = baseTitle.replace(DB_TITLE_BAD, '-')
  const dirRel = vaultRelDir(folder, subpath, atRoot)
  const csvFor = (name: string): string =>
    csvPathForFormDir(joinPath(dirRel, `${name}${FORM_DIR_SUFFIX}`))
  let name = baseName
  let n = 2
  while ((await readFileTextOrNull(csvFor(name))) !== null) name = `${baseName} ${n++}`
  const csvPath = csvFor(name)
  const folderSub = joinPath(subpath, `${name}${FORM_DIR_SUFFIX}`)

  const idField: DbField = { id: dbGenId(), name: 'id', type: 'text', hidden: true }
  const nameField: DbField = { id: dbGenId(), name: 'Name', type: 'text' }
  const fields = [idField, nameField]
  const { views, activeViewId } = buildDefaultViews(fields, dbGenId)
  const sidecar: DatabaseSidecar = {
    version: 1,
    idFieldId: idField.id,
    fields,
    views,
    activeViewId
  }

  await activeVault().createFolder(folder, folderSub)
  await dbPersistSidecar(csvPath, sidecar)
  await activeVault().writeNote(csvPath, serializeRows([], fields))
  return dbHydrate(csvPath, sidecar, [])
}

async function createRecordPage(csvPath: string, title: string, body: string): Promise<string> {
  const formDir = formDirFromCsvPath(toPosix(csvPath))
  if (!formDir) throw new Error(`Not a database folder: ${csvPath}`)
  const safe = (title.trim() || 'Untitled').replace(/[\\/]/g, '-')
  let finalTitle = safe
  let n = 2
  while ((await readFileTextOrNull(`${formDir}/${finalTitle}.md`)) !== null) {
    finalTitle = `${safe} ${n++}`
  }
  const noteRel = `${formDir}/${finalTitle}.md`
  await activeVault().writeNote(noteRel, body)
  return noteRel
}

async function renameDatabase(csvPath: string, newTitle: string): Promise<string> {
  const oldFormDir = formDirFromCsvPath(toPosix(csvPath))
  if (!oldFormDir) throw new Error(`Not a database folder: ${csvPath}`)
  const parentRel = oldFormDir.includes('/') ? oldFormDir.slice(0, oldFormDir.lastIndexOf('/')) : ''
  const safeName = (newTitle.trim() || 'Untitled Database').replace(DB_TITLE_BAD, '-')
  const makeFormDir = (name: string): string =>
    parentRel ? `${parentRel}/${name}${FORM_DIR_SUFFIX}` : `${name}${FORM_DIR_SUFFIX}`
  let targetFormDir = makeFormDir(safeName)
  if (targetFormDir === oldFormDir) return csvPath
  let n = 2
  while ((await readFileTextOrNull(csvPathForFormDir(targetFormDir))) !== null) {
    targetFormDir = makeFormDir(`${safeName} ${n++}`)
  }
  const atRoot = await primaryNotesAtRoot()
  const { folder, subpath: oldSub } = splitVaultPath(oldFormDir, atRoot)
  const { subpath: newSub } = splitVaultPath(targetFormDir, atRoot)
  await activeVault().renameFolder(folder, oldSub, newSub)
  return csvPathForFormDir(targetFormDir)
}

async function listDatabases(): Promise<DatabaseSummary[]> {
  const [folders, atRoot] = await Promise.all([activeVault().listFolders(), primaryNotesAtRoot()])
  const out: DatabaseSummary[] = []
  for (const f of folders) {
    if (!isFormDirName(f.subpath)) continue
    const csv = csvPathForFormDir(vaultRelDir(f.folder, f.subpath, atRoot))
    out.push({ path: csv, title: dbTitleFromPath(csv) })
  }
  return out.sort((a, b) => a.title.localeCompare(b.title))
}

// --------------------------------------------------------------------
// Asset URL resolution (WebView-loadable file URLs)
// --------------------------------------------------------------------

function resolveLocalAssetUrl(_vaultRoot: string, notePath: string, href: string): string | null {
  const trimmed = href.trim()
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return null
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)) return null

  const stripQueryAndHash = (value: string): string => {
    const hashIdx = value.indexOf('#')
    const queryIdx = value.indexOf('?')
    const cutIdx =
      hashIdx === -1 ? queryIdx : queryIdx === -1 ? hashIdx : Math.min(hashIdx, queryIdx)
    return cutIdx === -1 ? value : value.slice(0, cutIdx)
  }
  let decoded = stripQueryAndHash(trimmed)
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    // keep raw
  }
  const noteDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : ''
  let target: string
  if (decoded.startsWith('/')) {
    target = decoded.replace(/^\/+/, '')
  } else if (noteDir) {
    target = `${noteDir}/${decoded}`
  } else {
    target = decoded
  }
  target = posixNormalize(target)
  if (target.startsWith('../') || target === '..') return null
  return vault?.fs.fileSrc(target) ?? null
}

function resolveVaultAssetUrl(_vaultRoot: string, assetPath: string): string | null {
  const trimmed = assetPath.trim()
  if (!trimmed) return null
  const normalized = posixNormalize(trimmed.replace(/^\/+/, ''))
  if (normalized.startsWith('../') || normalized === '..') return null
  return vault?.fs.fileSrc(normalized) ?? null
}

// --------------------------------------------------------------------
// Dropped-file token bucket (mirrors the web bridge)
// --------------------------------------------------------------------

const droppedFiles = new Map<string, File>()

function getPathForFile(file: File): string | null {
  if (!file) return null
  const token = `mobile-drop://${crypto.randomUUID()}/${encodeURIComponent(file.name)}`
  droppedFiles.set(token, file)
  return token
}

async function importFilesToNote(notePath: string, sourcePaths: string[]): Promise<ImportedAsset[]> {
  const results: ImportedAsset[] = []
  for (const raw of sourcePaths) {
    const file = droppedFiles.get(raw)
    if (!file) continue
    results.push(await activeVault().importDroppedFile(notePath, file))
    droppedFiles.delete(raw)
  }
  return results
}

// --------------------------------------------------------------------
// Stubs shared with the web bridge (desktop-only surfaces)
// --------------------------------------------------------------------

function notImplemented(name: string): never {
  throw new Error(`zen.${name} is not available on iPhone`)
}

const unsupportedUpdateState: AppUpdateState = {
  phase: 'unsupported',
  currentVersion: APP_VERSION,
  availableVersion: null,
  releaseName: null,
  releaseDate: null,
  releaseNotes: null,
  progressPercent: null,
  transferredBytes: null,
  totalBytes: null,
  bytesPerSecond: null,
  message: 'Updates are delivered through the App Store.'
}

const MOBILE_CLI_STATUS: CliInstallStatus = {
  available: false,
  reason: 'CLI installation is only available in the desktop build.',
  defaultTarget: '',
  requiresSudo: false,
  targetOnPath: false,
  pathHint: null,
  installedAt: null,
  installedByThisApp: false,
  supportedPlatform: false
}

const MOBILE_RAYCAST_STATUS: RaycastExtensionStatus = {
  available: false,
  reason: 'Raycast extension installation is only available in the macOS desktop build.',
  supportedPlatform: false,
  installed: false,
  upToDate: false,
  extensionPath: '',
  sourcePath: null,
  raycastInstalled: false,
  nodeAvailable: false,
  npmAvailable: false,
  nodePath: null,
  npmPath: null,
  nodeVersion: null,
  npmVersion: null,
  nodeMeetsMinimum: false,
  npmMeetsMinimum: false,
  installedVersion: null,
  bundledVersion: APP_VERSION,
  lastInstalledAt: null
}

// --------------------------------------------------------------------
// The bridge object
// --------------------------------------------------------------------

export const mobileBridge: ZenBridge = {
  getCapabilities: (): ZenCapabilities => MOBILE_CAPABILITIES,
  getAppInfo: (): ZenAppInfo => MOBILE_APP_INFO,

  platform: async () => 'darwin' as NodeJS.Platform,
  platformSync: () => 'darwin' as NodeJS.Platform,
  listSystemFonts: async () => [
    'Avenir',
    'Charter',
    'Georgia',
    'Helvetica Neue',
    'Iowan Old Style',
    'Menlo',
    'New York',
    'Palatino',
    'SF Mono',
    'SF Pro Text',
    'Times New Roman'
  ],
  getAppIconDataUrl: async () => null,
  zoomInApp: async () => 1,
  zoomOutApp: async () => 1,
  resetAppZoom: async () => 1,
  getAppUpdateState: async () => unsupportedUpdateState,
  checkForAppUpdates: async () => unsupportedUpdateState,
  checkForAppUpdatesWithUi: async () => {},
  downloadAppUpdate: async () => unsupportedUpdateState,
  installAppUpdate: async () => {},

  getServerCapabilities: async (): Promise<ServerCapabilities | null> => null,
  getServerSession: async (): Promise<ServerSessionStatus> => ({
    authenticated: true,
    authRequired: false,
    supportsSessionLogin: false
  }),
  loginServerSession: async (): Promise<ServerSessionStatus> => ({
    authenticated: true,
    authRequired: false,
    supportsSessionLogin: false
  }),
  logoutServerSession: async (): Promise<ServerSessionStatus> => ({
    authenticated: true,
    authRequired: false,
    supportsSessionLogin: false
  }),
  getRemoteWorkspaceInfo: async () => null,
  connectRemoteWorkspace: () =>
    Promise.reject(new Error('Remote workspaces are not available on iPhone yet')),
  disconnectRemoteWorkspace: () =>
    Promise.reject(new Error('Remote workspaces are not available on iPhone yet')),
  listRemoteWorkspaceProfiles: async () => [],
  saveRemoteWorkspaceProfile: () =>
    Promise.reject(new Error('Remote workspaces are not available on iPhone yet')),
  deleteRemoteWorkspaceProfile: () =>
    Promise.reject(new Error('Remote workspaces are not available on iPhone yet')),
  connectRemoteWorkspaceProfile: () =>
    Promise.reject(new Error('Remote workspaces are not available on iPhone yet')),

  getCurrentVault: async () => currentVaultInfo(),
  listLocalVaults: async (): Promise<LocalVaultEntry[]> => {
    const dirs = await listVaultDirs()
    return dirs.map((d) => ({
      root: `${VAULT_ROOT_PREFIX}${d.name}`,
      name: d.name,
      lastOpenedAt: d.mtime
    }))
  },
  openLocalVault: async (root: string) => {
    // The vault switcher lists on-device vaults; opening one returns to
    // local storage mode.
    setStoragePref('local')
    return await openVaultByName(vaultNameFromRoot(root))
  },
  closeVault: async () => currentVaultInfo(),
  pickVault: async () => {
    const picked = await pickExternalVault()
    if (!picked) return null
    return await openVaultByName(picked.name, picked.url)
  },
  selectVaultPath: async (path: string) => {
    const name = sanitizeNoteTitle(vaultNameFromRoot(path))
    return await openVaultByName(name)
  },
  browseServerDirectories: async (path = ''): Promise<DirectoryBrowseResult> => {
    const dirs = await listVaultDirs()
    return {
      currentPath: path || VAULT_ROOT_PREFIX,
      parentPath: null,
      entries: dirs.map((d) => ({ name: d.name, path: `${VAULT_ROOT_PREFIX}${d.name}` })),
      shortcuts: [{ label: 'Vaults', path: VAULT_ROOT_PREFIX }]
    }
  },
  getVaultSettings: () => activeVault().getVaultSettings(),
  setVaultSettings: (next) => activeVault().setVaultSettings(next),
  readWorkspaceState: () => activeVault().readWorkspaceState(),
  writeWorkspaceState: (json) => activeVault().writeWorkspaceState(json),
  rootContentHiddenByInboxMode: () => activeVault().rootContentHiddenByInboxMode(),

  listNotes: () => activeVault().listNotes(),
  listFolders: () => activeVault().listFolders(),
  listAssets: () => activeVault().listAssets(),
  hasAssetsDir: () => activeVault().hasAssetsDir(),
  generateDemoTour: () => activeVault().generateDemoTour(),
  removeDemoTour: () => activeVault().removeDemoTour(),
  listTemplates: () => activeVault().listTemplates(),
  readTemplate: (sourcePath) => activeVault().readTemplate(sourcePath),
  writeTemplate: (input) => activeVault().writeTemplate(input),
  deleteTemplate: (sourcePath) => activeVault().deleteTemplate(sourcePath),
  getVaultTextSearchCapabilities: async (): Promise<VaultTextSearchCapabilities> => ({
    ripgrep: false,
    fzf: false
  }),
  searchVaultText: (
    query: string,
    _backend: VaultTextSearchBackendPreference = 'auto'
  ): Promise<VaultTextSearchMatch[]> => activeVault().searchVaultText(query),
  readNote: async (relPath) => {
    const content = await activeVault().readNote(relPath)
    // Drawings are view-only on phones (spec 06 defers touch drawing):
    // injecting viewModeEnabled at read time makes Excalidraw load with no
    // editing chrome — pan/zoom only. Never persisted (see writeNote).
    if (isPhoneViewport() && relPath.toLowerCase().endsWith('.excalidraw')) {
      try {
        const doc = JSON.parse(content.body) as { appState?: Record<string, unknown> }
        doc.appState = { ...(doc.appState ?? {}), viewModeEnabled: true }
        return { ...content, body: JSON.stringify(doc, null, 2) }
      } catch {
        // unparsable drawing — let the editor surface it as-is
      }
    }
    return content
  },
  readNoteComments: (relPath) => activeVault().readNoteComments(relPath),
  writeNoteComments: (relPath, comments) => activeVault().writeNoteComments(relPath, comments),
  scanTasks: () => activeVault().scanTasks(),
  scanTasksForPath: (relPath) => activeVault().scanTasksForPath(relPath),
  openDatabase,
  writeDatabaseRows,
  writeDatabaseSchema,
  createDatabase,
  renameDatabase,
  createRecordPage,
  listDatabases,
  writeNote: (relPath, body) => {
    // Insurance for the view-only drawing injection above: never let
    // viewModeEnabled reach disk, or desktop would open the drawing locked.
    if (relPath.toLowerCase().endsWith('.excalidraw')) {
      try {
        const doc = JSON.parse(body) as { appState?: Record<string, unknown> }
        if (doc.appState && 'viewModeEnabled' in doc.appState) {
          delete doc.appState.viewModeEnabled
          body = JSON.stringify(doc, null, 2)
        }
      } catch {
        // not JSON — write as-is
      }
    }
    return activeVault().writeNote(relPath, body)
  },
  appendToNote: (relPath, body, position) => activeVault().appendToNote(relPath, body, position),
  createNote: (folder, title, subpath) => activeVault().createNote(folder, title, subpath),
  createExcalidraw: (folder, subpath, title) =>
    activeVault().createExcalidraw(folder, subpath, title),
  renameNote: (relPath, nextTitle) => activeVault().renameNote(relPath, nextTitle),
  deleteNote: (relPath) => activeVault().deleteNote(relPath),
  moveToTrash: (relPath) => activeVault().moveToTrash(relPath),
  restoreFromTrash: (relPath) => activeVault().restoreFromTrash(relPath),
  emptyTrash: () => activeVault().emptyTrash(),
  archiveNote: (relPath) => activeVault().archiveNote(relPath),
  unarchiveNote: (relPath) => activeVault().unarchiveNote(relPath),
  duplicateNote: (relPath) => activeVault().duplicateNote(relPath),
  exportNotePdf: async () => {
    throw new Error('PDF export is available in the ZenNotes desktop app.')
  },
  revealNote: async () => {},
  revealNoteTarget: async () => {},
  revealFilePath: async () => {},
  moveNote: (relPath, targetFolder, targetSubpath) =>
    activeVault().moveNote(relPath, targetFolder, targetSubpath),
  importFilesToNote,
  importPastedImage: (input) => activeVault().importPastedImage(input),
  renameAsset: (relPath, nextName): Promise<AssetMeta> =>
    activeVault().renameAsset(relPath, nextName),
  moveAsset: (relPath, targetDir): Promise<AssetMeta> =>
    activeVault().moveAsset(relPath, targetDir),
  duplicateAsset: (relPath): Promise<AssetMeta> => activeVault().duplicateAsset(relPath),
  deleteAsset: (relPath): Promise<DeletedAsset> => activeVault().deleteAsset(relPath),
  restoreDeletedAsset: (asset): Promise<AssetMeta> => activeVault().restoreDeletedAsset(asset),
  listDeletedAssets: (): Promise<DeletedAsset[]> => activeVault().listDeletedAssets(),
  purgeDeletedAsset: (undoToken): Promise<void> => activeVault().purgeDeletedAsset(undoToken),
  emptyDeletedAssets: (): Promise<void> => activeVault().emptyDeletedAssets(),
  createFolder: (folder, subpath) => activeVault().createFolder(folder, subpath),
  renameFolder: (folder, oldSubpath, newSubpath) =>
    activeVault().renameFolder(folder, oldSubpath, newSubpath),
  deleteFolder: (folder, subpath) => activeVault().deleteFolder(folder, subpath),
  duplicateFolder: (folder, subpath) => activeVault().duplicateFolder(folder, subpath),
  revealFolder: async () => {},
  revealFolderTarget: async () => {},
  revealAssetsDir: async () => {},
  getPathForFile,
  openFolderTemporary: async () => {},
  resolveLocalAssetUrl,
  resolveVaultAssetUrl,

  onVaultChange,
  onOpenSettings: () => () => {},
  onOpenNoteRequested,
  notifyRendererReady: () => {},
  onAppUpdateState: () => () => {},

  windowMinimize: () => {},
  windowToggleMaximize: () => {},
  windowClose: () => {},
  openNoteWindow: async (relPath: string) => {
    requestOpenNote(relPath)
  },
  openVaultWindow: async () => null,
  readExternalFile: async () => notImplemented('readExternalFile'),
  writeExternalFile: async () => notImplemented('writeExternalFile'),
  moveExternalFileToVault: async () => notImplemented('moveExternalFileToVault'),
  openMarkdownFile: async () => false,
  toggleQuickCapture: async () => {
    const meta: NoteMeta = await activeVault().createNote('quick')
    requestOpenNote(meta.path)
  },
  getQuickCaptureHotkey: async () => '',
  setQuickCaptureHotkey: async () => ({
    ok: false,
    hotkey: '',
    error: 'Quick capture hotkeys are a desktop feature.'
  }),
  getQuickCapturePinned: async () => false,
  setQuickCapturePinned: async () => false,
  renderTikz: async (): Promise<TikzRenderResponse> => ({
    ok: false,
    error: 'TikZ renders on ZenNotes desktop; the source is shown here.'
  }),

  mcpGetRuntime: async () =>
    ({
      command: '',
      args: [],
      env: {},
      entryPath: null,
      available: false,
      reason: 'MCP client installation is only available in the desktop build.'
    }) as unknown as McpServerRuntime,
  mcpGetStatuses: async (): Promise<McpClientStatus[]> => [],
  mcpInstall: async () => notImplemented('mcpInstall'),
  mcpUninstall: async () => notImplemented('mcpUninstall'),
  mcpGetInstructions: async () =>
    ({
      defaultValue: '',
      current: '',
      isCustom: false,
      filePath: ''
    }) as unknown as McpInstructionsPayload,
  mcpSetInstructions: async () => notImplemented('mcpSetInstructions'),
  cliGetStatus: async () => MOBILE_CLI_STATUS,
  cliInstall: async () => notImplemented('cliInstall'),
  cliUninstall: async () => notImplemented('cliUninstall'),
  raycastGetStatus: async () => MOBILE_RAYCAST_STATUS,
  raycastInstall: async () => notImplemented('raycastInstall'),
  clipboardWriteText: (text: string) => {
    void Clipboard.write({ string: text }).catch(() => {})
  },
  clipboardReadText: () => '',

  getConfigSync: () => null,
  setConfig: async () => {},
  getConfigPath: async () => null,
  revealConfigFile: async () => {},
  onConfigChange: () => () => {},

  listCustomThemes: async () => [],
  getCustomThemesDir: async () => null,
  revealCustomThemesDir: async () => {},
  deleteCustomTheme: async () => {},
  createCustomTheme: async () => null,
  onCustomThemesChange: () => () => {},
  listOverrides: async () => [],
  revealOverridesDir: async () => {},
  deleteOverride: async () => {},
  onOverridesChange: () => () => {},
  toggleDevTools: async () => {}
}

export function installMobileBridge(): void {
  installZenBridge(mobileBridge)
}
