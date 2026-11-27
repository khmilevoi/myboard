import { BLOB_ID_PATTERN, FileImageSchema } from '@shared/files/contract'
import { z } from 'zod'

/** Who may read a blob: any signed-in member, or only one account. Fixed when the blob is written. */
export const FileAccessSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('members') }),
  z.object({ kind: z.literal('account'), accountId: z.string().min(1) }),
])
export type FileAccess = z.infer<typeof FileAccessSchema>

/**
 * `files:blob:<blobId>` — outside `ALLOWED_STORAGE_NAMESPACES`, so the generic storage routes can
 * never read or list it. `slot` is the owning slot (a storage full key, or `account:<id>#avatar`).
 * `disposition` is the Content-Disposition every read of the blob answers with.
 */
export const BlobRecordSchema = z.object({
  blobId: z.string().regex(BLOB_ID_PATTERN),
  slot: z.string(),
  access: FileAccessSchema,
  mime: z.string(),
  size: z.number().int().nonnegative(),
  name: z.string().optional(),
  image: FileImageSchema.optional(),
  disposition: z.string(),
  createdAt: z.number(),
})
export type BlobRecord = z.infer<typeof BlobRecordSchema>

export const BLOB_RECORD_PREFIX = 'files:blob:'

export function blobRecordKey(blobId: string): string {
  return BLOB_RECORD_PREFIX + blobId
}
