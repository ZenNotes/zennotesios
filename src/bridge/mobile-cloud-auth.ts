import { App as CapApp } from '@capacitor/app'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import {
  KeychainAccess,
  SecureStorage
} from '@aparajita/capacitor-secure-storage'
import type {
  CloudAccountConnectResult,
  CloudAccountStatus,
  CloudPublishedNote,
  CloudPublishedNoteResult,
  CloudPublishNoteInput,
  CloudServiceAccount,
  CloudSyncVault
} from '@zennotes/bridge-contract/cloud-sync'
import {
  CloudAuthFlow,
  parseCloudAuthCallback,
  type CloudAuthCredential,
  type CloudAuthExchangeRequest,
  type CloudAuthPending,
  type CloudAuthStorage
} from '@zennotes/shared-domain/cloud-auth-flow'
import {
  CloudE2eeKeyring,
  type CloudAccountKeyStore,
  type StoredCloudAccountKey
} from '@zennotes/shared-domain/cloud-e2ee-account'
import { createCloudSyncClient, firstValidationMessage, stopMobileCloudRequests, resumeMobileCloudRequests, mobileCloudRequestSignal } from './cloud-sync-client'
import { publishWithStagedUploads, type CloudPublishAssetPlatform } from '@zennotes/shared-domain/cloud-publish-uploads'
import { leaveApp, returnToApp } from './background-sync'

// The trailing-slash strip matters: allowedInsecureOrigins and the exchange
// URL are compared/joined against an origin with no trailing slash.
const DEVELOPMENT_CLOUD_BASE_URL = import.meta.env.VITE_ZENNOTES_CLOUD_DEV_URL?.trim().replace(/\/+$/, '')
const PRODUCTION_CLOUD_BASE_URL = 'https://zennotes.org'
const LEGACY_CLOUD_BASE_URL = 'https://zennotes.laravel.cloud'
const DEFAULT_CLOUD_BASE_URL = DEVELOPMENT_CLOUD_BASE_URL || PRODUCTION_CLOUD_BASE_URL
const PENDING_AUTH_KEY = 'pending-auth'
const CREDENTIAL_KEY = 'credential'
const ACCOUNT_KEY_PREFIX = 'cloud-e2ee:'
const accountListeners = new Set<(status: CloudAccountStatus) => void>()

/**
 * This app opens every path an end-to-end encrypted vault's bytes take:
 * inline content through the shared client, references through native
 * staging decryption, large uploads sealed natively, and backup archives
 * refused on the phone. Only with all of them in place may it tell the
 * service it can serve encrypted vaults (docs/specs/cloud-e2ee.md).
 */
export const MOBILE_END_TO_END_ENCRYPTION = true

let authFlow: CloudAuthFlow | null = null
let callbackQueue = Promise.resolve()
let appActive = true

// Lazy and retryable so a transient native storage failure does not poison
// every later account read for the session.
let secureStorageSetup: Promise<void> | null = null
function secureStorageReady(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve()
  if (!secureStorageSetup) {
    secureStorageSetup = configureSecureStorage()
    secureStorageSetup.catch(() => {
      secureStorageSetup = null
    })
  }
  return secureStorageSetup
}

async function configureSecureStorage(): Promise<void> {
  // The Capacitor proxy loads its implementation lazily. Parallel first
  // calls can initialize separate instances and lose the configured prefix.
  await SecureStorage.setKeyPrefix('zennotes.cloud.')
  await SecureStorage.setSynchronize(false)
  await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly)
  await migrateAuthStoragePrefix()
}

async function migrateAuthStoragePrefix(): Promise<void> {
  const keys = [CREDENTIAL_KEY, PENDING_AUTH_KEY]
  const canonical = new Map<string, string | null>()
  for (const key of keys) canonical.set(key, await SecureStorage.getItem(key))

  // Affected builds could persist auth under the plugin's default prefix.
  // All storage callers await setup, so none can see this temporary prefix.
  // CloudAuthFlow still validates every recovered record before using it.
  try {
    await SecureStorage.setKeyPrefix('capacitor-storage_')
    const legacy = new Map<string, string>()
    for (const key of keys) {
      const value = await SecureStorage.getItem(key)
      if (value !== null) legacy.set(key, value)
    }
    await SecureStorage.setKeyPrefix('zennotes.cloud.')
    for (const [key, value] of legacy) {
      if (canonical.get(key) === null) await SecureStorage.setItem(key, value)
    }
    // Remove superseded records as well, so logout cannot resurrect an older
    // credential on the next launch. Copying must finish before removal.
    await SecureStorage.setKeyPrefix('capacitor-storage_')
    for (const key of legacy.keys()) await SecureStorage.removeItem(key)
  } finally {
    await SecureStorage.setKeyPrefix('zennotes.cloud.')
  }
}

const storage: CloudAuthStorage = {
  async loadPending(): Promise<unknown> {
    if (!Capacitor.isNativePlatform()) return null
    await secureStorageReady()
    return parseStoredJson(await SecureStorage.getItem(PENDING_AUTH_KEY))
  },
  async savePending(pending: CloudAuthPending): Promise<void> {
    assertNativeCloudAuth()
    await secureStorageReady()
    await SecureStorage.setItem(PENDING_AUTH_KEY, JSON.stringify(pending))
  },
  async deletePending(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return
    await secureStorageReady()
    await SecureStorage.removeItem(PENDING_AUTH_KEY)
  },
  async loadCredential(): Promise<unknown> {
    if (!Capacitor.isNativePlatform()) return null
    await secureStorageReady()
    const credential = migrateLegacyCloudCredential(
      parseStoredJson(await SecureStorage.getItem(CREDENTIAL_KEY))
    )
    if (credential.migrated) {
      await SecureStorage.setItem(CREDENTIAL_KEY, JSON.stringify(credential.value))
    }
    return credential.value
  },
  async saveCredential(credential: CloudAuthCredential): Promise<void> {
    stopMobileCloudRequests()
    forgetKeyring()
    assertNativeCloudAuth()
    await secureStorageReady()
    const canonicalCredential = migrateLegacyCloudCredential(credential).value as CloudAuthCredential
    // Another account's encryption key never outlives a switch; signing the
    // same account in again keeps this device unlocked.
    await clearAccountKeys(accountKeyName(canonicalCredential.account))
    await SecureStorage.setItem(CREDENTIAL_KEY, JSON.stringify(canonicalCredential))
    if (appActive) resumeMobileCloudRequests()
  },
  async deleteCredential(): Promise<void> {
    stopMobileCloudRequests()
    forgetKeyring()
    if (!Capacitor.isNativePlatform()) return
    await secureStorageReady()
    await SecureStorage.removeItem(CREDENTIAL_KEY)
    // Signing out forgets this device's encryption keys too; the passphrase
    // or the recovery key unlocks the account again.
    await clearAccountKeys()
  }
}

/**
 * One account's unlocked end-to-end encryption key, in the Keychain with
 * the store's whenUnlockedThisDeviceOnly default and no iCloud sync. It is a
 * cache: the passphrase or the recovery key can always unlock it again.
 */
export function mobileCloudAccountKeyStore(account: CloudAuthCredential['account']): CloudAccountKeyStore {
  const name = accountKeyName(account)
  return {
    async load(): Promise<StoredCloudAccountKey | null> {
      if (!Capacitor.isNativePlatform()) return null
      await secureStorageReady()
      const value = parseStoredJson(await SecureStorage.getItem(name))
      return isRecord(value) && value.format === 1 && typeof value.key === 'string' && Number.isInteger(value.version)
        ? value as unknown as StoredCloudAccountKey
        : null
    },
    async save(value: StoredCloudAccountKey): Promise<void> {
      assertNativeCloudAuth()
      await secureStorageReady()
      await SecureStorage.setItem(name, JSON.stringify(value))
    },
    async clear(): Promise<void> {
      if (!Capacitor.isNativePlatform()) return
      await secureStorageReady()
      await SecureStorage.removeItem(name)
    }
  }
}

function accountKeyName(account: CloudAuthCredential['account']): string {
  return `${ACCOUNT_KEY_PREFIX}${account.base_url.trim()}#${account.user.email.trim().toLowerCase()}`
}

/** Every stored account key but `keep`. Callers have awaited the ready gate. */
async function clearAccountKeys(keep: string | null = null): Promise<void> {
  for (const name of await SecureStorage.keys()) {
    if (name.startsWith(ACCOUNT_KEY_PREFIX) && name !== keep) await SecureStorage.removeItem(name)
  }
}

// One keyring per signed-in credential, so the answers to "is this vault
// encrypted" and the opened ciphers last across calls but never across
// accounts or sign-ins.
let activeKeyring: { credential: CloudAuthCredential; keyring: CloudE2eeKeyring } | null = null

function keyringFor(credential: CloudAuthCredential): CloudE2eeKeyring {
  const current = activeKeyring?.credential
  if (
    activeKeyring && current && current.base_url === credential.base_url &&
    current.token === credential.token && current.account.user.email === credential.account.user.email
  ) {
    return activeKeyring.keyring
  }
  forgetKeyring()
  const keyring = new CloudE2eeKeyring({
    // A plain client: the keyring needs only each vault's encryption fields.
    listVaults: async () => (await createCloudSyncClient(credential.base_url, credential.token, {
      accountId: credential.account.user.email,
      signal: mobileCloudRequestSignal()
    }).listVaults()).data,
    store: mobileCloudAccountKeyStore(credential.account)
  })
  activeKeyring = { credential, keyring }
  return keyring
}

function forgetKeyring(): void {
  activeKeyring?.keyring.forget()
  activeKeyring = null
}

export async function configureMobileCloudAuth(appVersion: string): Promise<void> {
  if (authFlow) return

  authFlow = new CloudAuthFlow({
    platform: 'ios',
    appVersion,
    deviceName: 'ZenNotes iPhone',
    storage,
    openExternal: openExternalBrowser,
    exchange: exchangeCloudAuthCode,
    revoke: revokeCloudDevice,
    allowInsecureLoopback: import.meta.env.DEV,
    allowedInsecureOrigins: DEVELOPMENT_CLOUD_BASE_URL
      ? [DEVELOPMENT_CLOUD_BASE_URL]
      : undefined
  })

  await CapApp.addListener('appUrlOpen', ({ url }) => {
    if (isCloudAuthUrl(url)) scheduleAuthCallback(url)
  })
  await CapApp.addListener('appStateChange', ({ isActive }) => {
    appActive = isActive
    // Leaving stops Cloud requests, after a final sync when background sync
    // is on (background-sync.ts).
    if (isActive) returnToApp()
    else leaveApp()
  })
  const launch = await CapApp.getLaunchUrl()
  if (launch?.url && isCloudAuthUrl(launch.url)) scheduleAuthCallback(launch.url)
}

/** The scheme is shared with the widget links (ui-mobile/widget-links.ts);
 *  only `zennotes://auth…` is this module's to handle. */
function isCloudAuthUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim())
    return (
      parsed.protocol === 'zennotes:' &&
      (parsed.hostname || parsed.pathname.replace(/^\/+/, '')) === 'auth'
    )
  } catch {
    return false
  }
}

export async function getMobileCloudAccountStatus(): Promise<CloudAccountStatus> {
  return requireAuthFlow().status()
}

export async function connectMobileCloudAccount(
  baseUrl = DEFAULT_CLOUD_BASE_URL
): Promise<CloudAccountConnectResult> {
  assertNativeCloudAuth()
  const result = await requireAuthFlow().connect(baseUrl)
  await notifyAccountListeners()
  return result
}

export async function logoutMobileCloudAccount(): Promise<CloudAccountStatus> {
  stopMobileCloudRequests()
  const status = await requireAuthFlow().logout()
  notify(status)
  return status
}

export function onMobileCloudAccountChange(
  listener: (status: CloudAccountStatus) => void
): () => void {
  accountListeners.add(listener)
  return () => accountListeners.delete(listener)
}

export async function getMobileCloudServiceAccount(): Promise<CloudServiceAccount> {
  return (await authenticatedClient()).account().then((response) => response.data)
}

export async function listMobileCloudPublishedNotes(): Promise<CloudPublishedNote[]> {
  return (await authenticatedClient()).listPublishedNotes().then((response) => response.data)
}

/** Publish with the note's attachments staged straight to storage first
 *  (shared-domain's publishWithStagedUploads); a service without staged
 *  uploads gets the one-request publish. */
export async function publishMobileCloudNote<Handle>(
  input: CloudPublishNoteInput,
  assets: CloudPublishAssetPlatform<Handle>
): Promise<CloudPublishedNoteResult> {
  return await publishWithStagedUploads(await authenticatedClient(), input, assets)
}

export async function updateMobileCloudPublishedNote<Handle>(
  shareId: number,
  input: CloudPublishNoteInput,
  assets: CloudPublishAssetPlatform<Handle>
): Promise<CloudPublishedNoteResult> {
  return await publishWithStagedUploads(await authenticatedClient(), input, assets, { shareId })
}

export async function unpublishMobileCloudNote(shareId: number): Promise<void> {
  await (await authenticatedClient()).unpublishNote(shareId)
}

export async function listMobileCloudVaults(): Promise<CloudSyncVault[]> {
  return (await authenticatedClient()).listVaults().then((response) => response.data)
}

export async function authenticatedClient() {
  return (await mobileCloudConnection()).client
}

/** The signed-in account's client with its encryption keyring and this device's key store. */
export async function mobileCloudConnection() {
  const signal = mobileCloudRequestSignal()
  const credential = await authenticatedCredential()
  if (signal.aborted) throw new DOMException('Cloud account changed while loading credentials.', 'AbortError')
  const keyring = MOBILE_END_TO_END_ENCRYPTION ? keyringFor(credential) : undefined
  return {
    credential,
    client: createCloudSyncClient(credential.base_url, credential.token, {
      accountId: credential.account.user.email,
      signal,
      ...(keyring ? { keyring } : {})
    }),
    keyring,
    keyStore: mobileCloudAccountKeyStore(credential.account)
  }
}

export async function authenticatedCredential(): Promise<CloudAuthCredential> {
  const credential = await requireAuthFlow().credential()
  if (!credential) throw new Error('Connect ZenNotes Cloud before using sync.')
  return credential
}

function scheduleAuthCallback(rawUrl: string): void {
  const callback = parseCloudAuthCallback(rawUrl)
  if (!callback) {
    console.error('ZenNotes Cloud ignored an invalid auth callback URL.')
    return
  }

  callbackQueue = callbackQueue
    .then(async () => {
      const status = await requireAuthFlow().complete(callback)
      notify(status)
    })
    .catch((error: unknown) => {
      console.error('ZenNotes Cloud could not complete the auth callback.', error)
    })
}

async function notifyAccountListeners(): Promise<void> {
  notify(await requireAuthFlow().status())
}

function notify(status: CloudAccountStatus): void {
  for (const listener of accountListeners) listener(status)
}

function requireAuthFlow(): CloudAuthFlow {
  if (!authFlow) throw new Error('ZenNotes Cloud is not ready yet.')
  return authFlow
}

function assertNativeCloudAuth(): void {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('ZenNotes Cloud sign-in is only available in the native app.')
  }
}

async function openExternalBrowser(url: string): Promise<void> {
  window.open(url, '_blank', 'noopener,noreferrer')
}

async function exchangeCloudAuthCode(
  baseUrl: string,
  request: CloudAuthExchangeRequest
): Promise<unknown> {
  const response = await CapacitorHttp.post({
    url: `${baseUrl}/api/v1/app/exchange`,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    data: request,
    connectTimeout: 30_000,
    readTimeout: 30_000
  })

  if (response.status < 200 || response.status >= 300) {
    const payload = isRecord(response.data) ? response.data : {}
    const error = isRecord(payload.error) ? payload.error : {}
    const message =
      firstValidationMessage(payload.errors) ??
      (typeof error.message === 'string'
        ? error.message
        : typeof payload.message === 'string'
          ? payload.message
          : 'ZenNotes Cloud rejected this sign-in request.')
    throw new Error(message)
  }

  return response.data
}

/** Ends this device's access on the service at sign-out, as Connected apps on
 *  the website does. The shared flow bounds the wait and signs out whatever
 *  the answer; a 401 means the token is already gone. */
async function revokeCloudDevice(baseUrl: string, token: string): Promise<void> {
  const response = await CapacitorHttp.request({
    method: 'DELETE',
    url: `${baseUrl}/api/v1/devices/current`,
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    disableRedirects: true,
    connectTimeout: 10_000,
    readTimeout: 10_000
  })
  if ((response.status < 200 || response.status >= 300) && response.status !== 401) {
    throw new Error(`ZenNotes Cloud could not revoke this device (${response.status}).`)
  }
}

function parseStoredJson(value: string | null): unknown {
  if (value === null) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return {}
  }
}

function migrateLegacyCloudCredential(value: unknown): { migrated: boolean; value: unknown } {
  if (!isRecord(value) || value.base_url !== LEGACY_CLOUD_BASE_URL || !isRecord(value.account)) {
    return { migrated: false, value }
  }

  return {
    migrated: true,
    value: {
      ...value,
      base_url: PRODUCTION_CLOUD_BASE_URL,
      account: {
        ...value.account,
        base_url: PRODUCTION_CLOUD_BASE_URL
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}
