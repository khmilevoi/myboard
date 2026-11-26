import {
  effectiveMaxBytes,
  mimeMatchesAccept,
  normalizeMime,
  type FileImage,
  type FilePolicy,
} from '@shared/files/contract'
import * as errore from 'errore'

import {
  FileTooLargeError,
  FileTypeInvalidError,
  FileTypeMismatchError,
  FileTypeNotAcceptedError,
} from './errors'
import { isSniffableMime, sniffType } from './sniff'

export const MAX_FILE_NAME_LENGTH = 200

// C0 controls, DEL and C1 controls.
function isControlCharacter(c: string): boolean {
  const code = c.codePointAt(0) ?? 0
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
}

/**
 * The `x-file-name` header, decoded and made harmless: control characters and path separators
 * dropped, whitespace collapsed, at most 200 characters. Null when nothing usable is left.
 */
export function sanitizeFileName(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') return null
  // A header that is not valid percent-encoding is taken literally rather than refused.
  const decoded = errore.try(() => decodeURIComponent(raw))
  const text = decoded instanceof Error ? raw : decoded
  const cleaned = [...text]
    .filter((c) => !isControlCharacter(c) && c !== '/' && c !== '\\')
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  const capped = [...cleaned].slice(0, MAX_FILE_NAME_LENGTH).join('').trim()
  return capped === '' ? null : capped
}

const INLINE_EXACT = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'application/pdf',
  'text/plain',
])

/** Types a browser may render in place; everything else downloads. SVG and HTML never qualify. */
export function isInlineSafe(mime: string): boolean {
  return INLINE_EXACT.has(mime) || mime.startsWith('audio/') || mime.startsWith('video/')
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** `inline` for inline-safe types, else `attachment`; the file name RFC 5987-encoded when known. */
export function contentDisposition(mime: string, name: string | null): string {
  const kind = isInlineSafe(mime) ? 'inline' : 'attachment'
  if (name === null) return kind
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%]/g, '_')
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(name)}`
}

export type InspectedUpload = {
  mime: string
  size: number
  image: FileImage | null
  name: string | null
}

/**
 * The upload check, in order: size against the policy (clamped to the hard cap) → 413; a declared
 * type must be a well-formed MIME type → 415; a declared sniffable type the bytes do not confirm →
 * 415; the effective type (sniffed, else declared) must match the policy → 415.
 */
export function inspectUpload(options: {
  bytes: Uint8Array
  declaredType: string | undefined
  name: string | null
  policy: FilePolicy
}) {
  const { bytes, policy } = options
  const limit = effectiveMaxBytes(policy)
  if (bytes.byteLength > limit) return new FileTooLargeError({ limit: String(limit) })

  const declared = normalizeMime(options.declaredType ?? '')
  if (declared === null) return new FileTypeInvalidError()

  const detected = sniffType(bytes)
  if (isSniffableMime(declared) && detected?.mime !== declared) {
    return new FileTypeMismatchError({ declared, detected: detected?.mime ?? 'unrecognized' })
  }

  const mime = detected?.mime ?? declared
  if (!mimeMatchesAccept(mime, policy.accept)) return new FileTypeNotAcceptedError({ mime })

  const inspected: InspectedUpload = {
    mime,
    size: bytes.byteLength,
    image: detected?.image ?? null,
    name: options.name,
  }
  return inspected
}
