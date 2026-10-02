/**
 * External-folder vault tier (spec 03 "advanced" tier): the user picks any
 * Files-app folder (iCloud Drive, On My iPhone, Working Copy, ...) via the
 * native document picker; a security-scoped bookmark keeps it accessible
 * across launches. Only one bookmark is kept, so a pick replaces the folder
 * vault that was there, and the person is asked first
 * (folder-vault-replace.ts).
 */
import { registerPlugin } from '@capacitor/core'
import { setStoragePref } from './icloud'
import { pickAfterReplaceNotice, type FolderVaultReplaceNotice } from './folder-vault-replace'

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

const EXTERNAL_KEY = 'zn-mobile:external-vault'

export interface ExternalVaultRef {
  name: string
  bookmark: string
}

export function getExternalVaultRef(): ExternalVaultRef | null {
  try {
    const raw = localStorage.getItem(EXTERNAL_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ExternalVaultRef
    return parsed.bookmark ? parsed : null
  } catch {
    return null
  }
}

export function setExternalVaultRef(ref: ExternalVaultRef | null): void {
  if (ref) localStorage.setItem(EXTERNAL_KEY, JSON.stringify(ref))
  else localStorage.removeItem(EXTERNAL_KEY)
}

// The New Vault sheet asks in place, before the store starts a vault change,
// so its Cancel leaves the workspace exactly as it was. Its yes still has to
// cross the store to reach the picker (pickLocalVault takes no arguments),
// and it covers one pick of the folder it named; anything else asks here.
let replaceAnsweredFor: string | null = null

/** Records the New Vault sheet's yes for the folder vault it named. The
 *  returned release drops an answer no pick used (a refused vault change). */
export function answerExternalVaultReplace(bookmark: string): () => void {
  replaceAnsweredFor = bookmark
  return () => {
    if (replaceAnsweredFor === bookmark) replaceAnsweredFor = null
  }
}

/** Present the picker; on selection persist the bookmark + flip storage.
 *  With a folder vault already set, `confirm` is asked before the picker
 *  opens, and a no leaves the bookmark and the storage tier untouched. */
export async function pickExternalVault(
  confirm: (notice: FolderVaultReplaceNotice) => Promise<boolean>
): Promise<{ url: string; name: string } | null> {
  const current = getExternalVaultRef()
  const answered = current !== null && current.bookmark === replaceAnsweredFor
  replaceAnsweredFor = null
  return await pickAfterReplaceNotice(answered ? null : current, confirm, async () => {
    const result = await FolderPicker.pickFolder()
    if (result.cancelled || !result.url || !result.bookmark) return null
    setExternalVaultRef({ name: result.name ?? 'Vault', bookmark: result.bookmark })
    setStoragePref('external')
    return { url: result.url, name: result.name ?? 'Vault' }
  })
}

/** Re-open the bookmarked folder at boot (refreshing a stale bookmark). */
export async function resolveExternalVault(): Promise<{ url: string; name: string } | null> {
  const ref = getExternalVaultRef()
  if (!ref) return null
  try {
    const resolved = await FolderPicker.resolveBookmark({ bookmark: ref.bookmark })
    if (resolved.bookmark) {
      setExternalVaultRef({ name: resolved.name, bookmark: resolved.bookmark })
    }
    return { url: resolved.url, name: resolved.name }
  } catch {
    return null
  }
}
