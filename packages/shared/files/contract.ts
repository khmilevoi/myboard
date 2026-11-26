import { z } from 'zod'

import { scopedBranchPath, type ScopedBranch } from '../storage/scoped'

/**
 * File slots: a storage key whose value is a file reference. Bytes live in a blob store (Garage in
 * production), never in Valkey; the slot holds only the JSON ref. What a slot accepts is declared
 * per slot as a `FilePolicy` and enforced by the server. See
 * `docs/superpowers/specs/2026-11-26-media-slots-design.md` and the key-shape contract in
 * `packages/shared/storage/scope.ts`.
 */

/** The absolute upload cap, whatever a slot's policy says. */
export const FILES_HARD_MAX_BYTES = 25 * 1024 * 1024

/** A blob id is a `randomId()` (base64url); nginx and the server both match it with this. */
export const BLOB_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/

export function isValidBlobId(value: string): boolean {
  return BLOB_ID_PATTERN.test(value)
}

export const FileImageSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})
export type FileImage = z.infer<typeof FileImageSchema>

export const FileRefSchema = z.object({
  blobId: z.string().regex(BLOB_ID_PATTERN),
  url: z.string(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
  name: z.string().optional(),
  image: FileImageSchema.optional(),
  updatedAt: z.number(),
})
export type FileRef = z.infer<typeof FileRefSchema>

/**
 * Pixel rules for a slot that holds images, checked by `checkImageRules` (`./image-rules`): in the
 * browser before an upload, for the message, and on the server after a full decode, as the
 * authority. `square` wants width === height; `maxSide` / `minSide` bound both sides.
 */
export type FileImagePolicy = { square?: boolean; maxSide?: number; minSide?: number }

/**
 * What a slot accepts. `accept` entries are an exact `type/subtype`, a `type/*` family, or `*\/*`.
 * `maxBytes` is clamped to `FILES_HARD_MAX_BYTES`. With `image`, an upload must also decode as a
 * PNG, JPEG or WebP whose pixels satisfy those rules.
 */
export type FilePolicy = { accept: readonly string[]; maxBytes: number; image?: FileImagePolicy }

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

/** The browser uploads a 256×256 WebP; the server takes any square up to 512 px. */
export const AVATAR_POLICY: FilePolicy = {
  accept: IMAGE_MIME_TYPES,
  maxBytes: 2 * 1024 * 1024,
  image: { square: true, maxSide: 512 },
}

const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/

/** The lowercased `type/subtype` of a Content-Type (parameters dropped), or null when malformed. */
export function normalizeMime(contentType: string): string | null {
  const essence = (contentType.split(';')[0] ?? '').trim().toLowerCase()
  return MIME_PATTERN.test(essence) ? essence : null
}

export function mimeMatchesAccept(mime: string, accept: readonly string[]): boolean {
  const [type] = mime.split('/')
  return accept.some((entry) => entry === '*/*' || entry === mime || entry === `${type}/*`)
}

export function effectiveMaxBytes(policy: FilePolicy): number {
  return Math.min(policy.maxBytes, FILES_HARD_MAX_BYTES)
}

export const FILES_URL_PREFIX = '/files/'

export function fileUrl(blobId: string): string {
  return FILES_URL_PREFIX + blobId
}

/**
 * The sub-namespace a storage slot's relative key lives under. `@` is outside
 * `RELATIVE_KEY_PATTERN`, so the generic and scoped storage routes can never write a slot.
 */
export const FILE_SLOT_PREFIX = '@files/'

export function fileSlotRelativeKey(key: string): string {
  return FILE_SLOT_PREFIX + key
}

export function isFileSlotKey(relativeKey: string): boolean {
  return relativeKey.startsWith(FILE_SLOT_PREFIX)
}

/** The slot key inside `@files/`, or null when `relativeKey` is not a slot key. */
export function fileSlotInnerKey(relativeKey: string): string | null {
  return isFileSlotKey(relativeKey) ? relativeKey.slice(FILE_SLOT_PREFIX.length) : null
}

export function scopedFilePath(branch: ScopedBranch, key: string): string {
  return `/api/files${scopedBranchPath(branch)}/${encodeURIComponent(key)}`
}

export const ACCOUNT_AVATAR_PATH = '/api/files/account/avatar'

/** Request header carrying the original file name, `encodeURIComponent`-encoded. */
export const FILE_NAME_HEADER = 'x-file-name'

/** Response header of `GET /api/files/authorize`: the blob's stored Content-Disposition. */
export const FILE_DISPOSITION_HEADER = 'x-file-disposition'
