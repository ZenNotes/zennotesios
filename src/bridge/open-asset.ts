/**
 * Opening a vault attachment with the system — mobile's answer to the bridge
 * contract's `openAssetExternally`, which upstream added in 2.24 when
 * clicking a remote workspace's attachment failed on a path that exists only
 * on the server.
 *
 * iOS has no "default app" a process can hand a file to, so the share sheet
 * IS the opener: it offers Quick Look for the types iOS previews itself and
 * every installed app that claims the rest. The sheet can only present a file
 * that exists on this device, so a remote vault's asset is copied into a
 * per-open cache directory first — a fresh directory each time for the same
 * reason desktop uses a fresh temp dir: re-opening an attachment must not
 * overwrite the copy another app still has on screen.
 */
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { ensureDownloaded } from './icloud'
import { RemoteVault } from './remote-vault'
import type { MobileVault } from './vault-fs'
import { resolveSafeRel } from './vault-core'

/** Cache subtree holding copies staged out of a remote vault. */
const OPEN_CACHE_DIR = 'open-asset'

/** iOS rejects the share promise when the user dismisses the sheet. That is a
 *  decision, not a failure, and must not raise an error toast. */
function isDismissal(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /cancel/i.test(message)
}

export async function openAssetExternally(
  vault: MobileVault | RemoteVault,
  relPath: string
): Promise<{ ok: boolean; error?: string }> {
  let rel: string
  try {
    rel = resolveSafeRel(relPath)
  } catch {
    return { ok: false, error: 'That attachment path is not inside this vault.' }
  }
  try {
    const uri =
      vault instanceof RemoteVault
        ? await stageRemoteAsset(vault, rel)
        : await localAssetUri(vault, rel)
    if (!uri) return { ok: false, error: 'The attachment is missing from this vault.' }
    await Share.share({ files: [uri] })
    return { ok: true }
  } catch (err) {
    if (isDismissal(err)) return { ok: true }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function localAssetUri(vault: MobileVault, rel: string): Promise<string | null> {
  const uri = vault.fs.fileUri(rel)
  if (!uri) return null
  // An evicted iCloud asset is a `.name.icloud` stub on disk. Ask for the real
  // bytes before handing the path to another app, or the sheet opens nothing
  // — the same placeholder discipline reads follow (see native-fs.ts).
  if (vault.fs.isCloud) await ensureDownloaded(uri, 15000).catch(() => 0)
  if (!(await vault.fs.statOrNull(rel))) return null
  return uri
}

async function stageRemoteAsset(vault: RemoteVault, rel: string): Promise<string | null> {
  const { base64 } = await vault.client.fetchAssetBase64(rel)
  const name = rel.split('/').pop() || 'attachment'
  const dir = `${OPEN_CACHE_DIR}/${crypto.randomUUID()}`
  await Filesystem.mkdir({ path: dir, directory: Directory.Cache, recursive: true }).catch(() => {})
  const path = `${dir}/${name}`
  await Filesystem.writeFile({ path, directory: Directory.Cache, data: base64 })
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache })
  return uri
}
