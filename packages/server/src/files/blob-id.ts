import { isValidBlobId } from '@shared/files/contract'

import { FileStoreError } from './errors'

/** Every blob store refuses an id that could escape its path or object key. */
export function checkBlobId(operation: string, blobId: string): FileStoreError | null {
  if (isValidBlobId(blobId)) return null
  return new FileStoreError({ operation, blobId, cause: new Error('invalid blob id') })
}
