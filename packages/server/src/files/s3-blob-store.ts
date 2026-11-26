import { AwsClient } from 'aws4fetch'

import { checkBlobId } from './blob-id'
import type { BlobStore } from './blob-store'
import { FileStoreError } from './errors'

export type S3Credentials = { accessKeyId: string; secretAccessKey: string }

export const GARAGE_S3_REGION = 'garage'

class S3StatusError extends Error {}

/**
 * Garage (or any S3) through SigV4-signed path-style requests: `<endpoint>/<bucket>/<blobId>`.
 * Requests are signed with `aws4fetch` and sent with the injected `fetch`, so tests run without a
 * network and nothing retries behind the caller's back.
 */
export function makeS3BlobStore(options: {
  endpoint: string
  bucket: string
  credentials: S3Credentials
  region?: string
  fetch?: typeof globalThis.fetch
}): BlobStore {
  const send = options.fetch ?? globalThis.fetch
  const client = new AwsClient({
    accessKeyId: options.credentials.accessKeyId,
    secretAccessKey: options.credentials.secretAccessKey,
    service: 's3',
    region: options.region ?? GARAGE_S3_REGION,
    retries: 0,
  })
  const base = options.endpoint.replace(/\/+$/, '')
  const objectUrl = (blobId: string) =>
    `${base}/${encodeURIComponent(options.bucket)}/${encodeURIComponent(blobId)}`

  async function request(operation: string, blobId: string, init: RequestInit) {
    const fail = (cause: unknown) => new FileStoreError({ operation, blobId, cause })
    const signed = await client.sign(objectUrl(blobId), init).catch(fail)
    if (signed instanceof Error) return signed
    return send(signed).catch(fail)
  }

  return {
    async put(blobId, bytes, mime) {
      const invalid = checkBlobId('put', blobId)
      if (invalid !== null) return invalid
      const res = await request('put', blobId, {
        method: 'PUT',
        headers: { 'content-type': mime },
        body: new Uint8Array(bytes),
      })
      if (res instanceof Error) return res
      if (!res.ok) {
        const cause = new S3StatusError(`S3 PUT answered ${res.status}`)
        return new FileStoreError({ operation: 'put', blobId, cause })
      }
    },

    async delete(blobId) {
      const invalid = checkBlobId('delete', blobId)
      if (invalid !== null) return invalid
      const res = await request('delete', blobId, { method: 'DELETE' })
      if (res instanceof Error) return res
      // S3 answers 204 for a missing key too; 404 from a stricter implementation is just as done.
      if (!res.ok && res.status !== 404) {
        const cause = new S3StatusError(`S3 DELETE answered ${res.status}`)
        return new FileStoreError({ operation: 'delete', blobId, cause })
      }
    },

    async get(blobId) {
      if (checkBlobId('get', blobId) !== null) return null
      const res = await request('get', blobId, { method: 'GET' })
      if (res instanceof Error) return res
      if (res.status === 404) return null
      if (!res.ok) {
        const cause = new S3StatusError(`S3 GET answered ${res.status}`)
        return new FileStoreError({ operation: 'get', blobId, cause })
      }
      const body = await res
        .arrayBuffer()
        .catch((cause) => new FileStoreError({ operation: 'get', blobId, cause }))
      if (body instanceof Error) return body
      const mime = res.headers.get('content-type') ?? 'application/octet-stream'
      return { bytes: new Uint8Array(body), mime }
    },
  }
}
