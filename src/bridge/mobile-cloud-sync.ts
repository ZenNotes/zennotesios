import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import type {
  CloudBackupNoteRestoreResult,
  CloudBackupRestoreResult,
  CloudBackupSchedule,
  CloudBackupSnapshot,
  CloudBackupItemsPage,
  CloudBackupItemsQuery,
  CloudBackupSnapshotItem,
  CloudSyncRunSummary,
  CloudSyncPendingConflictDetails,
  CloudSyncPendingConflictResolution,
  CloudSyncBootstrapConflict,
  CloudSyncBootstrapConflictDetails,
  CloudSyncBootstrapConflictResolution,
  CloudSyncSettingsChoice,
  CloudSyncSettingsConflict,
  CloudVaultLink
} from '@zennotes/bridge-contract/cloud-sync'
import {
  CLOUD_SYNC_SETTINGS_CONFLICT_PATH,
  CLOUD_SYNC_VAULT_SETTINGS_PATH
} from '@zennotes/shared-domain/cloud-sync'
import {
  CloudSyncHostService,
  type CloudSyncHostPersistence,
  type CloudSyncHostVault
} from '@zennotes/shared-domain/cloud-sync-host-service'
import type { PortableCloudSyncFileSystem } from '@zennotes/shared-domain/cloud-sync-portable-filesystem'
import type { CloudSyncState } from '@zennotes/shared-domain/cloud-sync-engine'
import { fromBase64 } from '@zennotes/shared-domain/cloud-e2ee'
import { CLOUD_E2EE_HEADER, CLOUD_E2EE_HEADER_VALUE } from '@zennotes/shared-domain/cloud-e2ee-vault'
import { CachedCloudSyncRepository, type ScanCache } from './cloud-sync-repository'
import { MobileVault } from './vault-fs'
import { trackCloudSyncChanges } from './cloud-sync-refresh'
import {
  authenticatedClient,
  getMobileCloudAccountStatus,
  mobileCloudConnection
} from './mobile-cloud-auth'
import { isNotFoundError } from './native-fs'
import { randomUUID } from './uuid'

const STORAGE_ROOT = 'zennotes-cloud-sync'
const refreshStates = new WeakMap<MobileVault, { changed: boolean }>()

const persistence: CloudSyncHostPersistence = {
  async loadLink(vaultKey: string): Promise<unknown> {
    return readJson(await linkPath(vaultKey))
  },
  async saveLink(vaultKey: string, link: CloudVaultLink): Promise<void> {
    await writeJson(await linkPath(vaultKey), link)
  },
  async deleteLink(vaultKey: string): Promise<void> {
    await deleteDataFile(await linkPath(vaultKey))
  },
  async loadState(vaultKey: string, baseUrl: string, vaultId: string): Promise<unknown> {
    return readJson(await statePath(vaultKey, baseUrl, vaultId))
  },
  async saveState(vaultKey: string, baseUrl: string, state: CloudSyncState): Promise<void> {
    await writeJson(await statePath(vaultKey, baseUrl, state.vault_id), state)
  },
  async retireState(vaultKey: string, baseUrl: string, vaultId: string): Promise<void> {
    const path = await statePath(vaultKey, baseUrl, vaultId)
    let data: string
    try {
      const result = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 })
      data = typeof result.data === 'string' ? result.data : await result.data.text()
    } catch (error) {
      if (isNotFoundError(error)) return
      throw error
    }
    // Preserve the complete state, including unsent conflict drafts, before unlinking.
    await Filesystem.writeFile({
      path: path.replace('/states/', '/retired-states/').replace(/\.json$/, `.${randomUUID()}.json`),
      directory: Directory.Data, encoding: Encoding.UTF8, data, recursive: true
    })
    await deleteDataFile(path)
  }
}

const service = new CloudSyncHostService({
  persistence,
  accountStatus: getMobileCloudAccountStatus,
  createClient: authenticatedClient
})

export async function getMobileCloudVaultLink(vault: MobileVault): Promise<CloudVaultLink | null> {
  return service.linkedVault(hostVault(vault))
}

export async function linkMobileCloudVault(
  vault: MobileVault,
  vaultId: string
): Promise<CloudVaultLink> {
  // An encrypted vault's name and content need the account key, so linking
  // a locked device stops here instead of at the first sync.
  const { keyring } = await mobileCloudConnection()
  await keyring?.forVault(vaultId)
  return service.link(hostVault(vault), vaultId)
}

export async function createAndLinkMobileCloudVault(
  vault: MobileVault,
  name: string,
  options: { encrypted?: boolean } = {}
): Promise<CloudVaultLink> {
  if (!options.encrypted) return service.createAndLink(hostVault(vault), name)
  const normalizedName = name.trim()
  if (!normalizedName) throw new Error('Cloud vault name is required.')
  const { client, keyStore, keyring } = await mobileCloudConnection()
  if (!keyring) throw new Error('End-to-end encryption is not available in this build.')
  const stored = await keyStore.load()
  if (!stored) throw new Error('Unlock end-to-end encryption on this device first.')
  const created = (await client.createEncryptedVault(normalizedName, fromBase64(stored.key), stored.version)).data
  keyring.remember(created)
  // The service stores a placeholder name; the shared link step reads the
  // listing, which shows this unlocked device the real one.
  return service.link(hostVault(vault), created.id)
}

export async function unlinkMobileCloudVault(vault: MobileVault): Promise<void> {
  await service.unlink(hostVault(vault))
}

/** Permanently delete the cloud copy, then unlink this device (desktop parity). */
export async function deleteMobileCloudVault(vault: MobileVault): Promise<void> {
  await service.deleteLinkedVault(hostVault(vault))
}

/** The pending settings question, if sync parked a cloud version. It lives
 *  in the vault rather than in memory, so closing the app does not answer
 *  it by accident (desktop parity; ported from the Android shell). */
export async function getMobileCloudSettingsConflict(
  vault: MobileVault
): Promise<CloudSyncSettingsConflict | null> {
  const parked = await vault.fs.statOrNull(CLOUD_SYNC_SETTINGS_CONFLICT_PATH)
  if (parked?.type !== 'file') return null
  const raw = await vault.fs.readTextOrNull(CLOUD_SYNC_SETTINGS_CONFLICT_PATH)
  if (raw === null) return null
  // The parsed copy lets the app show what differs and offer a per-section
  // answer (desktop parity, #816). A copy that does not parse is still a
  // pending question (the file is there, and sync will not touch vault.json
  // until it is gone), so it is reported without the contents and the app
  // asks whole-file.
  const cloudSettings = parseParkedSettings(raw)
  return {
    path: CLOUD_SYNC_VAULT_SETTINGS_PATH,
    cloud_path: CLOUD_SYNC_SETTINGS_CONFLICT_PATH,
    ...(cloudSettings ? { cloud_settings: cloudSettings } : {})
  }
}

/** Answer it. Keeping this device's settings just drops the parked copy;
 *  the next sync pushes the local ones up. Taking the cloud's writes them
 *  through the vault's own normalizer, so a hand-edited or older-format
 *  file cannot land as broken settings. */
export async function resolveMobileCloudSettingsConflict(
  vault: MobileVault,
  choice: CloudSyncSettingsChoice
): Promise<void> {
  if (choice === 'cloud') {
    const raw = await vault.fs.readTextOrNull(CLOUD_SYNC_SETTINGS_CONFLICT_PATH)
    const parsed = raw === null ? null : parseParkedSettings(raw)
    if (!parsed) {
      throw new Error('The settings from the cloud could not be read, so nothing was changed.')
    }
    await vault.setVaultSettings(
      parsed as unknown as Parameters<MobileVault['setVaultSettings']>[0]
    )
  }
  await vault.fs.deleteFile(CLOUD_SYNC_SETTINGS_CONFLICT_PATH).catch(() => {})
}

function parseParkedSettings(raw: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return parsed as Record<string, unknown>
}

/** Check the server cursor without scanning the vault or downloading attachment bytes. */
export async function hasMobileCloudVaultChanges(vault: MobileVault): Promise<boolean> {
  return service.hasRemoteChanges(hostVault(vault))
}

export async function syncMobileCloudVault(vault: MobileVault): Promise<CloudSyncRunSummary> {
  // No emit here: the host service runs vault.rescan() after every sync
  // (cloud-sync-host-service run()'s finally), and rescan emits the one
  // 'resync' event app-core needs.
  return service.sync(hostVault(vault, true))
}

export async function getMobileCloudConflict(
  vault: MobileVault,
  conflictId: string
): Promise<CloudSyncPendingConflictDetails> {
  return service.getConflict(hostVault(vault), conflictId)
}

export async function getMobileCloudBootstrapConflict(
  vault: MobileVault,
  conflict: CloudSyncBootstrapConflict
): Promise<CloudSyncBootstrapConflictDetails> {
  return service.getBootstrapConflict(hostVault(vault), conflict)
}

export async function resolveMobileCloudBootstrapConflict(
  vault: MobileVault,
  resolution: CloudSyncBootstrapConflictResolution
): Promise<void> {
  await service.resolveBootstrapConflict(hostVault(vault), resolution)
}

export async function saveMobileCloudConflictDraft(
  vault: MobileVault,
  conflictId: string,
  draftText: string | null
): Promise<void> {
  await service.saveConflictDraft(hostVault(vault), conflictId, draftText)
}

export async function resolveMobileCloudConflict(
  vault: MobileVault,
  resolution: CloudSyncPendingConflictResolution
): Promise<void> {
  await service.resolveConflict(hostVault(vault), resolution)
}

export async function listMobileCloudBackups(vault: MobileVault): Promise<CloudBackupSnapshot[]> {
  return service.listBackups(hostVault(vault))
}

export async function getMobileCloudBackupSchedule(
  vault: MobileVault
): Promise<CloudBackupSchedule> {
  return service.backupSchedule(hostVault(vault))
}

export async function updateMobileCloudBackupSchedule(
  vault: MobileVault,
  enabled: boolean
): Promise<CloudBackupSchedule> {
  return service.updateBackupSchedule(hostVault(vault), enabled)
}

export async function listMobileCloudBackupItems(
  vault: MobileVault,
  backupId: string
): Promise<CloudBackupSnapshotItem[]> {
  return service.listBackupItems(hostVault(vault), backupId)
}

/** One page of a backup's notes, searched by path on the service, so the
 *  backup browser can reach notes past the first 50. */
export async function listMobileCloudBackupItemsPage(
  vault: MobileVault,
  backupId: string,
  query: CloudBackupItemsQuery
): Promise<CloudBackupItemsPage> {
  return service.listBackupItemsPage(hostVault(vault), backupId, query)
}

export async function createMobileCloudBackup(
  vault: MobileVault,
  label?: string
): Promise<CloudBackupSnapshot> {
  // A typed label would reach ZenNotes Cloud readable, so encrypted vaults
  // keep their backups unlabeled.
  const unlabeled = label !== undefined &&
    await linksEncryptedVault(await service.linkedVault(hostVault(vault)), await mobileCloudConnection())
  return service.createBackup(hostVault(vault), unlabeled ? undefined : label)
}

export async function deleteMobileCloudBackup(
  vault: MobileVault,
  backupId: string
): Promise<void> {
  await service.deleteBackup(hostVault(vault), backupId)
}

export async function downloadMobileCloudBackup(
  vault: MobileVault,
  backupId: string
): Promise<void> {
  const link = await service.linkedVault(hostVault(vault))
  if (!link) throw new Error('Link this local vault to a ZenNotes Cloud vault first.')
  const connection = await mobileCloudConnection()
  const { credential, keyring } = connection
  if (link.base_url !== credential.base_url) {
    throw new Error('This vault is linked to a different ZenNotes Cloud account.')
  }
  // The phone shares the service's archive as it is, and an encrypted
  // vault's holds ciphertext under path ids; the desktop app decrypts it.
  if (await linksEncryptedVault(link, connection)) {
    throw new Error('Download backups of encrypted vaults from the ZenNotes desktop app.')
  }

  const safeBackupId = backupId.replace(/[^a-zA-Z0-9-]/g, '')
  if (!safeBackupId) throw new Error('That backup identifier is invalid.')
  const path = `zennotes-cloud-backups/${randomUUID()}/zennotes-backup-${safeBackupId}.json.gz`
  const url = `${credential.base_url}/api/v1/vaults/${encodeURIComponent(link.vault_id)}/backups/${encodeURIComponent(backupId)}/download`
  await Filesystem.downloadFile({
    url,
    path,
    directory: Directory.Cache,
    recursive: true,
    headers: {
      Accept: 'application/gzip',
      Authorization: `Bearer ${credential.token}`,
      ...(keyring ? { [CLOUD_E2EE_HEADER]: CLOUD_E2EE_HEADER_VALUE } : {})
    },
    connectTimeout: 30_000,
    readTimeout: 120_000
  })
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache })
  try {
    await Share.share({ title: 'ZenNotes backup', files: [uri] })
  } catch (error) {
    if (!/cancel/i.test(error instanceof Error ? error.message : String(error))) throw error
  }
}

export async function restoreMobileCloudBackup(
  vault: MobileVault,
  backupId: string
): Promise<CloudBackupRestoreResult> {
  return service.restoreBackup(hostVault(vault), backupId)
}

export async function restoreMobileCloudBackupNote(
  vault: MobileVault,
  backupId: string,
  snapshotItemId: number
): Promise<CloudBackupNoteRestoreResult> {
  return service.restoreBackupNote(hostVault(vault), backupId, snapshotItemId)
}

/** Whether a link names an end-to-end encrypted vault; a locked device knows too. */
async function linksEncryptedVault(
  link: CloudVaultLink | null,
  { credential, keyring }: Awaited<ReturnType<typeof mobileCloudConnection>>
): Promise<boolean> {
  // Another account's link fails in the shared service with its own message.
  if (!link || !keyring || link.base_url !== credential.base_url) return false
  try {
    return (await keyring.forVault(link.vault_id)) !== null
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'E2EE_LOCKED') return true
    throw error
  }
}

function hostVault(vault: MobileVault, cacheScan = false): CloudSyncHostVault {
  // Folders this operation has made, so a pull asks for each one once rather
  // than before every file it renames into place.
  const folders = new Set<string>()
  const fs: PortableCloudSyncFileSystem = {
    // Strict on purpose: NativeFs.readdir maps failure to [], which scan()
    // would read as an empty vault and plan a delete for every tracked item.
    readdir: async (directory) =>
      (await vault.fs.readdirStrict(directory)).map((entry) => ({
        name: entry.name,
        type: entry.type === 'directory' ? 'directory' : 'file'
      })),
    // The contract's null means verified absence — it drives delete/conflict
    // decisions — and an evicted iCloud file must never read as deleted.
    stat: (path) => vault.fs.statVerified(path),
    readBase64: (path) => vault.fs.readBase64(path),
    writeText: (path, value) => vault.fs.writeText(path, value),
    writeBase64: (path, value) => vault.fs.writeBase64(path, value),
    deleteFile: (path) => vault.fs.deleteFile(path),
    rename: async (from, to) => {
      // A pulled move carries no write that would create the destination
      // folder, and Capacitor's rename fails on a missing parent.
      const parent = to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : ''
      if (parent && !folders.has(parent)) {
        await vault.fs.mkdir(parent)
        folders.add(parent)
      }
      try {
        await vault.fs.rename(from, to)
      } catch (error) {
        // The folder may have gone since: a rename into a missing folder
        // fails before it changes anything, and the next one makes it again.
        folders.delete(parent)
        throw error
      }
    }
  }

  const vaultKey = vault.fs.rootPath
  const state = refreshStates.get(vault) ?? { changed: false }
  refreshStates.set(vault, state)
  const changes = trackCloudSyncChanges(fs, () => vault.rescan(), state)
  return {
    // The contract requires a key stable per local vault. rootLabel resolves
    // to an absolute container URI whose UUID iOS rotates on app update and
    // restore; rootPath (ZenNotes/<name>) survives both, and keeps the link
    // when a vault migrates between the local and iCloud tiers.
    key: vaultKey,
    repository: new CachedCloudSyncRepository(changes.fs, vault.fs, {
      // A transient failure here disables skipping for the run (full read) —
      // the safe direction — rather than failing or, worse, mis-skipping.
      loadTracked: async () => {
        // Review/restore actions always receive real bytes, not scan placeholders.
        if (!cacheScan) return null
        const link = await readJson(await linkPath(vaultKey))
        if (!isRecord(link) || typeof link.base_url !== 'string' || typeof link.vault_id !== 'string') {
          return null
        }
        return (await readJson(
          await statePath(vaultKey, link.base_url, link.vault_id)
        )) as CloudSyncState | null
      },
      loadCache: async () => readJson(await scanCachePath(vaultKey)),
      saveCache: async (cache: ScanCache) => writeJson(await scanCachePath(vaultKey), cache)
    }, changes.markChanged),
    refresh: changes.refresh
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

async function scanCachePath(vaultKey: string): Promise<string> {
  return `${STORAGE_ROOT}/scan-cache/${await fingerprint(vaultKey)}.json`
}

async function linkPath(vaultKey: string): Promise<string> {
  return `${STORAGE_ROOT}/links/${await fingerprint(vaultKey)}.json`
}

async function statePath(vaultKey: string, baseUrl: string, vaultId: string): Promise<string> {
  return `${STORAGE_ROOT}/states/${await fingerprint(vaultKey)}/${await fingerprint(baseUrl)}/${await fingerprint(vaultId)}.json`
}

async function readJson(path: string): Promise<unknown> {
  let raw: string
  try {
    const result = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 })
    raw = typeof result.data === 'string' ? result.data : await result.data.text()
  } catch (err) {
    // Only a verified not-found may read as "no link / no state" — a
    // transient read failure surfacing as null would re-bootstrap the vault
    // and forget acknowledged offline deletions.
    if (isNotFoundError(err)) return null
    throw err
  }
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await Filesystem.writeFile({
    path,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    data: JSON.stringify(value),
    recursive: true
  })
}

async function deleteDataFile(path: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path, directory: Directory.Data })
  } catch (error) {
    if (!isNotFoundError(error)) throw error
  }
}

async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
