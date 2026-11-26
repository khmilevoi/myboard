import * as errore from 'errore'

/** Base for every file failure the routes answer with; same shape as `ScopedStorageError`. */
export class FileError extends Error {
  status = 500
  code = 'file_error'
  publicMessage = 'File error'
}

export class FileTooLargeError extends errore.createTaggedError({
  name: 'FileTooLargeError',
  message: 'Upload exceeds $limit bytes',
  extends: FileError,
}) {
  status = 413
  code = 'file_too_large'
  publicMessage = 'File is too large'
}

export class FileTypeInvalidError extends errore.createTaggedError({
  name: 'FileTypeInvalidError',
  message: 'Content-Type is missing or malformed',
  extends: FileError,
}) {
  status = 415
  code = 'file_type_invalid'
  publicMessage = 'Content-Type is missing or malformed'
}

export class FileTypeMismatchError extends errore.createTaggedError({
  name: 'FileTypeMismatchError',
  message: 'Declared $declared but the bytes are $detected',
  extends: FileError,
}) {
  status = 415
  code = 'file_type_mismatch'
  publicMessage = 'Content-Type does not match the file'
}

export class FileTypeNotAcceptedError extends errore.createTaggedError({
  name: 'FileTypeNotAcceptedError',
  message: 'This slot does not accept $mime',
  extends: FileError,
}) {
  status = 415
  code = 'file_type_not_accepted'
  publicMessage = 'This file type is not accepted here'
}

export class FileSlotUndeclaredError extends errore.createTaggedError({
  name: 'FileSlotUndeclaredError',
  message: 'No file policy is declared for $slot',
  extends: FileError,
}) {
  status = 403
  code = 'file_slot_undeclared'
  publicMessage = 'Files are not enabled for this slot'
}

export class FileNotFoundError extends errore.createTaggedError({
  name: 'FileNotFoundError',
  message: 'Blob $blobId not found',
  extends: FileError,
}) {
  status = 404
  code = 'file_not_found'
  publicMessage = 'Not found'
}

export class FileForbiddenError extends errore.createTaggedError({
  name: 'FileForbiddenError',
  message: 'Blob $blobId is not readable by this session',
  extends: FileError,
}) {
  status = 403
  code = 'file_forbidden'
  publicMessage = 'Forbidden'
}

export class FileSessionRequiredError extends errore.createTaggedError({
  name: 'FileSessionRequiredError',
  message: 'A session is required for files',
  extends: FileError,
}) {
  status = 401
  code = 'session_missing'
  publicMessage = 'Session required'
}

export class FileUnavailableError extends errore.createTaggedError({
  name: 'FileUnavailableError',
  message: 'File storage is unavailable: $reason',
  extends: FileError,
}) {
  status = 503
  code = 'files_unavailable'
  publicMessage = 'File storage is unavailable'
}

/** A blob store or record failure: an operator-facing 500, logged with its cause. */
export class FileStoreError extends errore.createTaggedError({
  name: 'FileStoreError',
  message: 'File store $operation failed for $blobId',
  extends: FileError,
}) {
  status = 500
  code = 'file_store_failed'
  publicMessage = 'File storage failed'
}

export class FileBodyError extends errore.createTaggedError({
  name: 'FileBodyError',
  message: 'Could not read the request body',
  extends: FileError,
}) {
  status = 400
  code = 'file_body_invalid'
  publicMessage = 'Could not read the upload'
}
