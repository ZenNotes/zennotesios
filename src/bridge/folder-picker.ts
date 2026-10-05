/**
 * External-folder vault tier (spec 03 "advanced" tier): the user picks any
 * Files-app folder (iCloud Drive, On My iPhone, Working Copy, ...) via the
 * native document picker; a security-scoped bookmark keeps it accessible
 * across launches.
 *
 * Every picked folder stays in the Vaults sheet until the person removes it,
 * as on Android (zennotes#584). Nothing native ever limited this to one:
 * FolderPickerPlugin resolves whichever bookmark it is handed and
 * CloudFilesPlugin admits every root activated this session. Only the
 * single localStorage slot did, and a new pick overwrote the folder in it.
 * That slot is still written, as the pointer to the current folder vault
 * (an earlier build reads it as its one folder), and on the first read
 * after the update its folder becomes the list's first entry with its
 * bookmark bytes as they were.
 *
 * A folder is known by a random id, not by its bookmark: iOS hands back new
 * bookmark bytes on every pick and when a stored one goes stale, and the
 * root token the Vaults sheet switches by must not change with them. A pick
 * of a folder that is already listed is recognized by where it resolves.
 */
import { registerPlugin } from '@capacitor/core'
import { setStoragePref } from './icloud'
import { randomUUID } from './uuid'

interface FolderPickerPlugin {
  pickFolder(): Promise<{
    cancelled: boolean
    url?: string
    name?: string
    bookmark?: string
  }>
  resolveBookmark(options: {
    bookmark: string
  }): Promise<{ url: string; name: string; bookmark?: string }>
}

export const FolderPicker = registerPlugin<FolderPickerPlugin>('FolderPicker')

const CURRENT_KEY = 'zn-mobile:external-vault' // the current folder vault (the old single slot)
const LIST_KEY = 'zn-mobile:external-vaults' // every folder vault in the Vaults sheet

/** Root tokens the Vaults sheet hands to openLocalVault. The bare token is
 *  from before the list and means the current folder vault. */
export const EXTERNAL_VAULT_ROOT = 'zn://external-vault'
export const EXTERNAL_VAULT_ROOT_PREFIX = 'zn://external-vaults/'

export interface ExternalVaultRef {
  id: string
  name: string
  /** Base64 bookmark data, exactly as FolderPickerPlugin returned it. */
  bookmark: string
  /** file:// URL the bookmark last resolved to. A folder carried over from
   *  the single slot has none until it is next opened. */
  url?: string
}

type ResolvedRef = ExternalVaultRef & { url: string }

export function externalVaultRoot(id: string): string {
  return `${EXTERNAL_VAULT_ROOT_PREFIX}${encodeURIComponent(id)}`
}

export function isExternalVaultRoot(root: string): boolean {
  return root === EXTERNAL_VAULT_ROOT || root.startsWith(EXTERNAL_VAULT_ROOT_PREFIX)
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

/** A stored entry, which an earlier build wrote without an id or a url. */
function readRef(value: unknown): (Omit<ExternalVaultRef, 'id'> & { id?: string }) | null {
  if (!value || typeof value !== 'object') return null
  const { id, name, bookmark, url } = value as Record<string, unknown>
  if (typeof bookmark !== 'string' || !bookmark) return null
  return {
    ...(typeof id === 'string' && id ? { id } : {}),
    name: typeof name === 'string' && name ? name : 'Vault',
    bookmark,
    ...(typeof url === 'string' && url ? { url } : {})
  }
}

function withId(ref: Omit<ExternalVaultRef, 'id'> & { id?: string }): ExternalVaultRef {
  return { ...ref, id: ref.id ?? randomUUID() }
}

function saveRefs(refs: ExternalVaultRef[]): void {
  localStorage.setItem(LIST_KEY, JSON.stringify(refs))
}

function writeCurrent(ref: ExternalVaultRef | null): void {
  if (ref) localStorage.setItem(CURRENT_KEY, JSON.stringify(ref))
  else localStorage.removeItem(CURRENT_KEY)
}

/** Every folder vault, oldest first. */
export function getExternalVaultRefs(): ExternalVaultRef[] {
  const stored = readJson(LIST_KEY)
  if (Array.isArray(stored)) {
    const refs = stored.map(readRef).filter((ref) => ref !== null)
    if (refs.every((ref) => ref.id)) return refs as ExternalVaultRef[]
    const named = refs.map(withId)
    saveRefs(named)
    return named
  }
  // First read after the update: the single slot's folder starts the list.
  const single = readRef(readJson(CURRENT_KEY))
  const seeded = single ? [withId(single)] : []
  saveRefs(seeded)
  if (seeded[0]) writeCurrent(seeded[0])
  return seeded
}

/** The folder vault that is open, or was open last: boot reopens this one.
 *  A slot an earlier build wrote can name a folder the list has never seen,
 *  and that folder joins the list rather than being dropped. */
export function getExternalVaultRef(): ExternalVaultRef | null {
  const refs = getExternalVaultRefs()
  const current = readRef(readJson(CURRENT_KEY))
  if (!current) return null
  const known = refs.find((ref) =>
    current.id ? ref.id === current.id : ref.bookmark === current.bookmark
  )
  if (known) return known
  const adopted = withId(current)
  saveRefs([...refs, adopted])
  writeCurrent(adopted)
  return adopted
}

/** Root token of the current folder vault: two listed folders can share a
 *  name, so the Vaults sheet tells the open one by this. */
export function currentExternalVaultRoot(): string | null {
  const ref = getExternalVaultRef()
  return ref ? externalVaultRoot(ref.id) : null
}

function idFromRoot(root: string): string | null {
  if (root === EXTERNAL_VAULT_ROOT) return getExternalVaultRef()?.id ?? null
  if (!root.startsWith(EXTERNAL_VAULT_ROOT_PREFIX)) return null
  try {
    return decodeURIComponent(root.slice(EXTERNAL_VAULT_ROOT_PREFIX.length))
  } catch {
    return null
  }
}

/** Writes `ref` over the entry with its id, or appends it when `add`.
 *  False when there was no entry to write over and `add` is off. */
function saveRef(ref: ExternalVaultRef, add: boolean): boolean {
  const refs = getExternalVaultRefs()
  const at = refs.findIndex((entry) => entry.id === ref.id)
  if (at >= 0) refs[at] = ref
  else if (add) refs.push(ref)
  else return false
  saveRefs(refs)
  if (readRef(readJson(CURRENT_KEY))?.id === ref.id) writeCurrent(ref)
  return true
}

/** Resolves a listed folder's bookmark, which also opens its security scope
 *  for this session, and keeps what iOS reports: the folder's current name
 *  and place, and fresh bookmark bytes when the stored ones went stale. Null
 *  when iOS cannot resolve it, or when the folder left the list meanwhile
 *  (a removed folder must not come back as the current one). */
async function resolveRef(ref: ExternalVaultRef): Promise<ResolvedRef | null> {
  try {
    const resolved = await FolderPicker.resolveBookmark({ bookmark: ref.bookmark })
    const fresh: ResolvedRef = {
      ...ref,
      name: resolved.name || ref.name,
      bookmark: resolved.bookmark ?? ref.bookmark,
      url: resolved.url
    }
    return saveRef(fresh, false) ? fresh : null
  } catch {
    return null
  }
}

/** One folder as a path: a picked URL and a resolved bookmark's URL may spell
 *  it with different percent-encoding, a trailing slash or not, and /var
 *  with or without the /private it links to. */
function folderPath(url: string): string {
  let path = url.replace(/^file:\/\//, '')
  try {
    path = decodeURIComponent(path)
  } catch {
    // Not percent-encoded after all: compare it as it is.
  }
  return path.replace(/\/+$/, '').replace(/^\/private(?=\/var\/)/, '')
}

/** The listed folder a pick landed on, if any. Only a folder carried over
 *  from the single slot lacks a url, and only one with the picked name is
 *  resolved to learn where it is. */
async function listedFolderAt(url: string, name: string): Promise<ExternalVaultRef | null> {
  const target = folderPath(url)
  const refs = getExternalVaultRefs()
  const known = refs.find((ref) => ref.url !== undefined && folderPath(ref.url) === target)
  if (known) return known
  for (const ref of refs) {
    if (ref.url !== undefined || ref.name !== name) continue
    const resolved = await resolveRef(ref)
    if (resolved && folderPath(resolved.url) === target) return resolved
  }
  return null
}

/** Present the picker; the chosen folder joins the list (or refreshes its
 *  entry when it is already listed) and becomes the current vault. */
export async function pickExternalVault(): Promise<{ url: string; name: string } | null> {
  const result = await FolderPicker.pickFolder()
  if (result.cancelled || !result.url || !result.bookmark) return null
  const name = result.name ?? 'Vault'
  const listed = await listedFolderAt(result.url, name)
  const ref: ExternalVaultRef = {
    id: listed?.id ?? randomUUID(),
    name,
    bookmark: result.bookmark,
    url: result.url
  }
  saveRef(ref, true)
  writeCurrent(ref)
  setStoragePref('external')
  return { url: result.url, name }
}

/** Re-open the current folder vault at boot (refreshing a stale bookmark). */
export async function resolveExternalVault(): Promise<{ url: string; name: string } | null> {
  const ref = getExternalVaultRef()
  const resolved = ref ? await resolveRef(ref) : null
  return resolved ? { url: resolved.url, name: resolved.name } : null
}

/** Resolves the listed folder a root token names and makes it the current
 *  vault. Null, with nothing changed, when the token names no listed folder
 *  or iOS cannot reopen it (the entry stays, to retry or remove). */
export async function selectExternalVault(
  root: string
): Promise<{ url: string; name: string } | null> {
  const id = idFromRoot(root)
  const ref = id === null ? undefined : getExternalVaultRefs().find((entry) => entry.id === id)
  const resolved = ref ? await resolveRef(ref) : null
  if (!resolved) return null
  writeCurrent(resolved)
  setStoragePref('external')
  return { url: resolved.url, name: resolved.name }
}

/** Drops the folder a root token names from the list, without touching its
 *  files; the other folders and their bookmarks stay as they are. */
export function forgetExternalVault(root: string): void {
  const id = idFromRoot(root)
  if (id === null) return
  const current = getExternalVaultRef()
  saveRefs(getExternalVaultRefs().filter((ref) => ref.id !== id))
  if (current?.id === id) writeCurrent(null)
}
