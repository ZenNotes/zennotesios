import { CapacitorHttp } from '@capacitor/core'
import {
  CloudSyncApiClient,
  type CloudSyncHttpRequest,
  type CloudSyncHttpTransport
} from '@zennotes/shared-domain/cloud-sync-api'
import type {
  CloudSyncMutationRequest,
  CloudSyncMutationResponse
} from '@zennotes/bridge-contract/cloud-sync'
import {
  MobileDirectUploadError,
  mobileObjectUploadOptions,
  mutateWithMobileDirectUploads,
  type MobileObjectUpload
} from './mobile-direct-upload'

export class CloudServiceRequestError extends Error {
  readonly status: number
  readonly code: string | null
  readonly details: Record<string, unknown> | null

  constructor(
    message: string,
    status: number,
    code: string | null,
    details: Record<string, unknown> | null = null
  ) {
    super(message)
    this.name = 'CloudServiceRequestError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function createCloudSyncClient(baseUrl: string, token: string): CloudSyncApiClient {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '')
  const transport: CloudSyncHttpTransport = {
    async request<Response>(request: CloudSyncHttpRequest): Promise<Response> {
      const multipart = request.body instanceof FormData
      const response = await CapacitorHttp.request({
        method: request.method,
        url: `${normalizedBaseUrl}${request.path}`,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(multipart
            ? { 'Content-Type': 'multipart/form-data' }
            : request.body === undefined
              ? {}
              : { 'Content-Type': 'application/json' })
        },
        data: request.body instanceof FormData
          ? await serializeFormData(request.body)
          : request.body,
        ...(multipart ? { dataType: 'formData' as const } : {}),
        connectTimeout: 30_000,
        // Generous on purpose: a first sync of an attachment-heavy vault
        // legitimately pushes 100-item base64 batches over cellular, and a
        // timeout here retries into the same wall forever. Desktop's fetch
        // transport has no read timeout at all.
        readTimeout: request.timeoutMs ?? 300_000
      })

      if (response.status < 200 || response.status >= 300) {
        const error = response.data?.error
        const validationMessage = firstValidationMessage(response.data?.errors)
        throw new CloudServiceRequestError(
          validationMessage ?? (typeof error?.message === 'string'
            ? error.message
            : typeof response.data?.message === 'string'
              ? response.data.message
              : `ZenNotes Cloud request failed (${response.status}).`),
          response.status,
          typeof error?.code === 'string' ? error.code : null,
          isRecord(error?.details) ? error.details : null
        )
      }

      // Capacitor only JSON-parses application/json responses; a 2xx whose
      // body is HTML or truncated arrives as a string and would flow into
      // upstream typed as the API shape, failing far from the cause.
      if (typeof response.data === 'string') {
        if (response.data === '') return undefined as Response
        try {
          return JSON.parse(response.data) as Response
        } catch {
          throw new CloudServiceRequestError(
            'ZenNotes Cloud returned an unexpected response.',
            response.status,
            null
          )
        }
      }
      return response.data as Response
    }
  }

  return new MobileCloudSyncApiClient(transport, uploadObject)
}

class MobileCloudSyncApiClient extends CloudSyncApiClient {
  constructor(
    http: CloudSyncHttpTransport,
    private readonly uploadObject: MobileObjectUpload
  ) {
    super(http)
  }

  override async mutate(
    vaultId: string,
    body: CloudSyncMutationRequest
  ): Promise<CloudSyncMutationResponse> {
    return mutateWithMobileDirectUploads(
      {
        mutate: (nextVaultId, nextBody) => super.mutate(nextVaultId, nextBody),
        initiateUpload: (nextVaultId, nextBody) => super.initiateUpload(nextVaultId, nextBody),
        completeUpload: (nextVaultId, uploadId) => super.completeUpload(nextVaultId, uploadId),
        abortUpload: (nextVaultId, uploadId) => super.abortUpload(nextVaultId, uploadId)
      },
      vaultId,
      body,
      this.uploadObject
    )
  }
}

const uploadObject: MobileObjectUpload = async (request) => {
  const response = await CapacitorHttp.request(mobileObjectUploadOptions(request))
  if (response.status < 200 || response.status >= 300) {
    throw new MobileDirectUploadError(
      `ZenNotes Cloud object upload failed (${response.status}).`,
      response.status,
      'DIRECT_UPLOAD_FAILED'
    )
  }
}

export function firstValidationMessage(errors: unknown): string | null {
  if (!errors || typeof errors !== 'object') return null

  for (const messages of Object.values(errors)) {
    if (Array.isArray(messages)) {
      const message = messages.find((candidate): candidate is string => typeof candidate === 'string')
      if (message) return message
    }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function serializeFormData(form: FormData): Promise<Array<{
  key: string
  value: string
  type: 'base64File' | 'string'
  contentType?: string
  fileName?: string
}>> {
  const entries = []
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') {
      entries.push({ key, value, type: 'string' as const })
      continue
    }
    entries.push({
      key,
      value: await blobToBase64(value),
      type: 'base64File' as const,
      contentType: value.type || 'application/octet-stream',
      fileName: value.name
    })
  }
  return entries
}

// Everything here still crosses the WebKit bridge as one JSON message, and
// the WebView content process lives under iOS jetsam limits — refuse clearly
// above this rather than dying mid-publish with a white screen.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

async function blobToBase64(blob: Blob & { name?: string }): Promise<string> {
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new CloudServiceRequestError(
      `${blob.name ?? 'An attachment'} is ${Math.round(blob.size / (1024 * 1024))} MB — files over ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB cannot be uploaded from the app yet.`,
      413,
      'attachment-too-large'
    )
  }
  // FileReader encodes natively: peak memory is the blob plus one base64
  // string, instead of the ~6x of arrayBuffer → Uint8Array → binary string →
  // btoa.
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Attachment read failed.'))
    reader.readAsDataURL(blob)
  })
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}
