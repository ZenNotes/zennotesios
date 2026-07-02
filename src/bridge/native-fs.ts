/**
 * Thin async wrapper over @capacitor/filesystem scoped to the vault root.
 *
 * Two storage modes (spec 03):
 *  - local:  vault under Documents/ZenNotes/<vault> (Directory.Documents)
 *  - icloud: vault under the ubiquity container, addressed by absolute
 *    file:// URLs (Capacitor Filesystem accepts them when `directory` is
 *    omitted)
 *
 * iCloud placeholder discipline: evicted files appear as `.name.icloud`
 * stubs. readdir() maps stubs back to their logical names so notes never
 * look deleted, and readText() requests a download and retries before
 * failing (the Obsidian "placeholder read as missing" bug class).
 *
 * All paths passed in are vault-relative POSIX paths; this module owns the
 * translation to the on-device location. Nothing above this file touches
 * Capacitor directly for file I/O.
 */
import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem, type FileInfo } from '@capacitor/filesystem'
import { ensureDownloaded } from './icloud'

export const VAULTS_DIR = 'ZenNotes'

export interface StatResult {
  type: 'file' | 'directory'
  size: number
  mtime: number
  ctime: number | null
  uri: string
}

interface FsLocation {
  path: string
  directory?: Directory
}

function encodeSegments(rel: string): string {
  return rel
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

const ICLOUD_STUB_RE = /^\.(.+)\.icloud$/

export class NativeFs {
  /** Path of the vault root inside Directory.Documents (local mode). */
  readonly rootPath: string
  /** file:// URL of the vault root in the ubiquity container (icloud mode). */
  readonly cloudRootUri: string | null
  /** Native URI of the vault root, resolved at open. */
  rootUri: string | null = null

  constructor(vaultName: string, cloudRootUri: string | null = null) {
    this.rootPath = `${VAULTS_DIR}/${vaultName}`
    this.cloudRootUri = cloudRootUri
  }

  get isCloud(): boolean {
    return this.cloudRootUri !== null
  }

  private loc(relPath: string): FsLocation {
    if (this.cloudRootUri) {
      return {
        path: relPath ? `${this.cloudRootUri}/${encodeSegments(relPath)}` : this.cloudRootUri
      }
    }
    return {
      path: relPath ? `${this.rootPath}/${relPath}` : this.rootPath,
      directory: Directory.Documents
    }
  }

  async init(): Promise<void> {
    const root = this.loc('')
    await Filesystem.mkdir({ ...root, recursive: true }).catch(() => {})
    if (this.cloudRootUri) {
      this.rootUri = this.cloudRootUri
    } else {
      const { uri } = await Filesystem.getUri({
        path: this.rootPath,
        directory: Directory.Documents
      })
      this.rootUri = uri
    }
  }

  /** WebView-loadable URL for a vault-relative file (images, PDFs, ...). */
  fileSrc(relPath: string): string | null {
    if (!this.rootUri) return null
    if (this.cloudRootUri) {
      return Capacitor.convertFileSrc(`${this.cloudRootUri}/${encodeSegments(relPath)}`)
    }
    return Capacitor.convertFileSrc(`${this.rootUri}/${encodeSegments(relPath)}`)
  }

  async readText(relPath: string): Promise<string> {
    try {
      return await this.readTextOnce(relPath)
    } catch (err) {
      if (!this.cloudRootUri) throw err
      // The file may be an evicted iCloud item — request it and retry.
      await ensureDownloaded(this.loc(relPath).path, 15000)
      return await this.readTextOnce(relPath)
    }
  }

  private async readTextOnce(relPath: string): Promise<string> {
    const res = await Filesystem.readFile({ ...this.loc(relPath), encoding: Encoding.UTF8 })
    return typeof res.data === 'string' ? res.data : await res.data.text()
  }

  async readTextOrNull(relPath: string): Promise<string | null> {
    try {
      return await this.readText(relPath)
    } catch {
      return null
    }
  }

  /**
   * Plain overwrite, matching desktop `writeNote` (which uses fs.writeFile,
   * not the atomic path). No `.tmp`/`.bak` siblings: anything non-md left in
   * a note folder surfaces in listAssets and the sidebar as a stray file.
   */
  async writeText(relPath: string, body: string): Promise<void> {
    await Filesystem.writeFile({
      ...this.loc(relPath),
      data: body,
      encoding: Encoding.UTF8,
      recursive: true
    })
  }

  /** Write binary data from a base64 string (Capacitor's native transport). */
  async writeBase64(relPath: string, base64Data: string): Promise<void> {
    await Filesystem.writeFile({
      ...this.loc(relPath),
      data: base64Data,
      recursive: true
    })
  }

  async statOrNull(relPath: string): Promise<StatResult | null> {
    try {
      const s = await Filesystem.stat(this.loc(relPath))
      return {
        type: s.type === 'directory' ? 'directory' : 'file',
        size: s.size,
        mtime: s.mtime,
        ctime: s.ctime ?? null,
        uri: s.uri
      }
    } catch {
      return null
    }
  }

  async readdir(relPath: string): Promise<FileInfo[]> {
    try {
      const res = await Filesystem.readdir(this.loc(relPath))
      if (!this.cloudRootUri) return res.files
      return mapICloudStubs(res.files)
    } catch {
      return []
    }
  }

  async mkdir(relPath: string): Promise<void> {
    await Filesystem.mkdir({ ...this.loc(relPath), recursive: true }).catch((err) => {
      const msg = String((err as Error)?.message ?? err)
      if (!/exist/i.test(msg)) throw err
    })
  }

  async rename(fromRel: string, toRel: string): Promise<void> {
    const from = this.loc(fromRel)
    const to = this.loc(toRel)
    await Filesystem.rename({
      from: from.path,
      to: to.path,
      directory: from.directory,
      toDirectory: to.directory
    })
  }

  async copy(fromRel: string, toRel: string): Promise<void> {
    const from = this.loc(fromRel)
    const to = this.loc(toRel)
    await Filesystem.copy({
      from: from.path,
      to: to.path,
      directory: from.directory,
      toDirectory: to.directory
    })
  }

  async deleteFile(relPath: string): Promise<void> {
    await Filesystem.deleteFile(this.loc(relPath))
  }

  async rmdir(relPath: string): Promise<void> {
    await Filesystem.rmdir({ ...this.loc(relPath), recursive: true })
  }

  async exists(relPath: string): Promise<boolean> {
    return (await this.statOrNull(relPath)) !== null
  }
}

/** Map `.name.icloud` eviction stubs to their logical entries (deduped
 *  against already-materialized siblings). */
function mapICloudStubs(files: FileInfo[]): FileInfo[] {
  const realNames = new Set(files.map((f) => f.name))
  const out: FileInfo[] = []
  for (const f of files) {
    const m = f.name.match(ICLOUD_STUB_RE)
    if (!m) {
      out.push(f)
      continue
    }
    const logical = m[1]!
    if (realNames.has(logical)) continue
    out.push({ ...f, name: logical, type: 'file' })
  }
  return out
}

/** List vault directories under Documents/ZenNotes (local mode). */
export async function listVaultDirs(): Promise<{ name: string; mtime: number }[]> {
  try {
    const res = await Filesystem.readdir({ path: VAULTS_DIR, directory: Directory.Documents })
    return res.files
      .filter((f) => f.type === 'directory' && !f.name.startsWith('.'))
      .map((f) => ({ name: f.name, mtime: f.mtime }))
  } catch {
    return []
  }
}
