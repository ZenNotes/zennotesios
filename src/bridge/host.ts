/**
 * This app's side of @zennotes/portable-vault: the Capacitor plugins behind
 * the package's host interfaces. The vault layer and Cloud glue this repo
 * used to carry as src/bridge/ copies (shared, by hand, with the Android
 * shell) are the package's now; what is left here is what only an iPhone
 * does. Where vaults live (on the device, iCloud, a Files-app folder) is
 * mobile-bridge.ts's, which adds `vaults` and installs the whole host.
 *
 * Storage identity is byte for byte what the copies used, so an update finds
 * everything an older build wrote: Cloud state as UTF-8 files in
 * Directory.Data under the package's `zennotes-cloud-sync/` keys, remote
 * profiles in Capacitor Preferences, secrets in the Keychain under the
 * `zennotes.cloud.` prefix, the account key named by account ('labeled').
 */
import { App as CapApp } from '@capacitor/app'
import { Capacitor, CapacitorHttp, type HttpOptions } from '@capacitor/core'
import { Clipboard } from '@capacitor/clipboard'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Preferences } from '@capacitor/preferences'
import { Share } from '@capacitor/share'
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage'
import type { ZenAppInfo } from '@zennotes/bridge-contract/bridge'
import type {
  AppLifecycle,
  HostShell,
  HostStorage,
  HttpTransport,
  PortableHost,
  SecretStorage
} from '@zennotes/portable-vault/host'
import { localNetworkConnectionHint } from '@zennotes/portable-vault/remote-client'
import { randomUUID } from '@zennotes/portable-vault/uuid'
import { waitAtBoot } from '../boot-wait'
import { isPhoneDevice } from '../viewport'
import { leaveApp, returnToApp } from './background-sync'
import { isNotFoundError, putFile } from './native-fs'
import { TYPOGRAPHY_FONT_FAMILIES } from './typography-fonts'

/**
 * The shipped version, read from the native bundle at boot
 * (CFBundleShortVersionString) rather than written down here. A literal in
 * this file is a second place to remember on every release, and it lost that
 * race: the About screen still read 0.1.0 at version 1.4. Info.plist is the
 * one the App Store actually ships, so it is the one to believe.
 *
 * The fallback only covers `npm run dev` in a plain browser, where there is
 * no native bundle to ask.
 */
let appVersion = '0.0.0-dev'

export async function loadNativeAppVersion(): Promise<string> {
  try {
    // Bounded (boot-wait.ts): a late answer is dropped, so the version stays
    // the placeholder Cloud sign-in is configured with.
    const info = await waitAtBoot('the app version', CapApp.getInfo())
    if (info.inTime && info.value.version) appVersion = info.value.version
  } catch {
    // No native layer (browser dev server): keep the placeholder.
  }
  return appVersion
}

function appInfo(): ZenAppInfo {
  return {
    name: 'zennotes-iphone',
    productName: 'ZenNotes',
    version: appVersion,
    description: 'ZenNotes for iPhone',
    homepage: 'https://zennotes.org',
    runtime: 'web',
    hostKind: 'ios',
    // WKWebView's user agent names the iOS version and the WebKit build, the
    // two lines a bug report from a phone needs beside the app version
    // (#814); nothing else here is guessed.
    ...(typeof navigator !== 'undefined' && navigator.userAgent ? { engine: navigator.userAgent } : {})
  }
}

const shell: HostShell = {
  appInfo,
  platform: 'darwin',
  // A curated list (WebKit cannot enumerate fonts), so a font installed on
  // the device never shows up here: the Ubuntu families ship with the app
  // instead (typography-fonts.ts, public/fonts).
  listSystemFonts: async () => [...TYPOGRAPHY_FONT_FAMILIES],
  updatesMessage: 'Updates are delivered through the App Store.',
  unavailableWhere: 'on iPhone',
  // Drawings are view-only on phones (spec 06 defers touch drawing). Gated
  // on the DEVICE, not the layout: an iPad in Split View keeps editable
  // drawings, and a read-time injection must not depend on a classification
  // that can change after the note is already open.
  drawingsViewOnly: () => isPhoneDevice(),
  writeClipboard: async (text) => {
    await Clipboard.write({ string: text })
  },
  async saveDownload({ url, headers, fileName, title, connectTimeout, readTimeout }) {
    const path = `zennotes-cloud-backups/${randomUUID()}/${fileName}`
    await Filesystem.downloadFile({ url, path, directory: Directory.Cache, recursive: true, headers, connectTimeout, readTimeout })
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache })
    try {
      await Share.share({ title, files: [uri] })
    } catch (error) {
      if (!/cancel/i.test(error instanceof Error ? error.message : String(error))) throw error
    }
  },
  remoteConnectionHint: () => localNetworkConnectionHint(),
  cloud: {
    platform: 'ios',
    deviceName: 'ZenNotes iPhone',
    developmentBaseUrl: import.meta.env.VITE_ZENNOTES_CLOUD_DEV_URL,
    allowInsecureLoopback: import.meta.env.DEV,
    accountKeyScheme: 'labeled'
  }
}

const lifecycle: AppLifecycle = {
  async onOpenUrl(listener) {
    await CapApp.addListener('appUrlOpen', ({ url }) => listener(url))
  },
  async launchUrl() {
    return (await CapApp.getLaunchUrl())?.url ?? null
  },
  async onActiveChange(listener) {
    await CapApp.addListener('appStateChange', ({ isActive }) => listener(isActive))
  },
  // Leaving stops Cloud requests, after a final sync when background sync is
  // on (background-sync.ts, which stops the package's own request lifetime).
  leftApp: () => leaveApp(),
  returnedToApp: () => returnToApp()
}

const http: HttpTransport = {
  request: (options) => CapacitorHttp.request(options as HttpOptions),
  putFile: (options) => putFile(options)
}

/** Cloud link, sync state and scan cache: UTF-8 files in Directory.Data. */
const storage: HostStorage = {
  async read(key) {
    try {
      const result = await Filesystem.readFile({ path: key, directory: Directory.Data, encoding: Encoding.UTF8 })
      return typeof result.data === 'string' ? result.data : await result.data.text()
    } catch (error) {
      // Only a verified not-found reads as "no link / no state".
      if (isNotFoundError(error)) return null
      throw error
    }
  },
  async write(key, value) {
    await Filesystem.writeFile({ path: key, directory: Directory.Data, encoding: Encoding.UTF8, data: value, recursive: true })
  },
  async remove(key) {
    try {
      await Filesystem.deleteFile({ path: key, directory: Directory.Data })
    } catch (error) {
      if (!isNotFoundError(error)) throw error
    }
  }
}

/** Saved self-hosted profiles and the workspace mode: Capacitor Preferences. */
const preferences: HostStorage = {
  read: async (key) => (await Preferences.get({ key })).value,
  write: async (key, value) => {
    await Preferences.set({ key, value })
  },
  remove: async (key) => {
    await Preferences.remove({ key })
  }
}

const PREFIX = 'zennotes.cloud.'
const LEGACY_PREFIX = 'capacitor-storage_'
const AUTH_KEYS = ['credential', 'pending-auth']

async function configureSecureStorage(): Promise<void> {
  // The Capacitor proxy loads its implementation lazily. Parallel first
  // calls can initialize separate instances and lose the configured prefix;
  // the package runs this once, behind its ready gate, before any read.
  await SecureStorage.setKeyPrefix(PREFIX)
  await SecureStorage.setSynchronize(false)
  await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly)
  await migrateAuthStoragePrefix()
}

export async function migrateAuthStoragePrefix(): Promise<void> {
  const canonical = new Map<string, string | null>()
  for (const key of AUTH_KEYS) canonical.set(key, await SecureStorage.getItem(key))

  // Affected builds could persist auth under the plugin's default prefix.
  // All storage callers await setup, so none can see this temporary prefix.
  // CloudAuthFlow still validates every recovered record before using it.
  try {
    await SecureStorage.setKeyPrefix(LEGACY_PREFIX)
    const legacy = new Map<string, string>()
    for (const key of AUTH_KEYS) {
      const value = await SecureStorage.getItem(key)
      if (value !== null) legacy.set(key, value)
    }
    await SecureStorage.setKeyPrefix(PREFIX)
    for (const [key, value] of legacy) {
      if (canonical.get(key) === null) await SecureStorage.setItem(key, value)
    }
    // Remove superseded records as well, so logout cannot resurrect an older
    // credential on the next launch. Copying must finish before removal.
    await SecureStorage.setKeyPrefix(LEGACY_PREFIX)
    for (const key of legacy.keys()) await SecureStorage.removeItem(key)
  } finally {
    await SecureStorage.setKeyPrefix(PREFIX)
  }
}

/** The credential, the pending sign-in and the account key: the Keychain. */
const secrets: SecretStorage = {
  available: () => Capacitor.isNativePlatform(),
  prepare: () => configureSecureStorage(),
  get: (key) => SecureStorage.getItem(key),
  set: async (key, value) => {
    await SecureStorage.setItem(key, value)
  },
  remove: async (key) => {
    await SecureStorage.removeItem(key)
  },
  keys: () => SecureStorage.keys()
}

/** Everything but `vaults`, which mobile-bridge.ts adds with the tiers. */
export const iphoneHost: Omit<PortableHost, 'vaults'> = {
  shell,
  lifecycle,
  http,
  storage,
  preferences,
  secrets
}
