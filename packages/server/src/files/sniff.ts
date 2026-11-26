import type { FileImage } from '@shared/files/contract'

/** The types `sniffType` recognizes; a declared one of these must be confirmed by the bytes. */
export const SNIFFABLE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
] as const
export type SniffableMime = (typeof SNIFFABLE_MIME_TYPES)[number]

export function isSniffableMime(mime: string): mime is SniffableMime {
  return (SNIFFABLE_MIME_TYPES as readonly string[]).includes(mime)
}

/** `image` is null when the type is recognized but its header is too short to read a size. */
export type SniffedType = { mime: SniffableMime; image: FileImage | null }

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function startsWith(bytes: Uint8Array, prefix: readonly number[], at = 0): boolean {
  if (bytes.length < at + prefix.length) return false
  return prefix.every((byte, i) => bytes[at + i] === byte)
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  if (bytes.length < at + length) return ''
  return String.fromCharCode(...bytes.subarray(at, at + length))
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function size(width: number, height: number): FileImage | null {
  return width > 0 && height > 0 ? { width, height } : null
}

function pngSize(bytes: Uint8Array): FileImage | null {
  // Signature (8), IHDR length (4), 'IHDR' (4), width (4, BE), height (4, BE).
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== 'IHDR') return null
  const data = view(bytes)
  return size(data.getUint32(16), data.getUint32(20))
}

function gifSize(bytes: Uint8Array): FileImage | null {
  // 'GIF87a' | 'GIF89a', then the logical screen width and height (LE16).
  if (bytes.length < 10) return null
  const data = view(bytes)
  return size(data.getUint16(6, true), data.getUint16(8, true))
}

// SOF0–SOF15 carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) share the range but do not.
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

function jpegSize(bytes: Uint8Array): FileImage | null {
  const data = view(bytes)
  let at = 2
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return null
    // Any number of 0xFF fill bytes may precede a marker.
    while (at < bytes.length && bytes[at] === 0xff) at += 1
    if (at >= bytes.length) return null
    const marker = bytes[at] as number
    at += 1
    // Standalone markers: TEM and RST0–RST7 have no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    // EOI or the start of scan before any frame header: there is no size to read.
    if (marker === 0xd9 || marker === 0xda) return null
    if (at + 2 > bytes.length) return null
    const length = data.getUint16(at)
    if (length < 2) return null
    // length (2), precision (1), height (2), width (2)
    if (isStartOfFrame(marker)) {
      return at + 7 > bytes.length ? null : size(data.getUint16(at + 5), data.getUint16(at + 3))
    }
    at += length
  }
  return null
}

function webpSize(bytes: Uint8Array): FileImage | null {
  const data = view(bytes)
  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8 ') {
    // Chunk data at 20: frame tag (3), start code 9D 01 2A, then 14-bit width and height (LE).
    if (bytes.length < 30 || !startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) return null
    return size(data.getUint16(26, true) & 0x3fff, data.getUint16(28, true) & 0x3fff)
  }
  if (chunk === 'VP8L') {
    // Chunk data at 20: signature 0x2F, then width-1 (14 bits) and height-1 (14 bits), LE.
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null
    const bits = data.getUint32(21, true)
    return size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
  }
  if (chunk === 'VP8X') {
    // Chunk data at 20: flags (1), reserved (3), canvas width-1 (24 bits LE), height-1 (24 bits LE).
    if (bytes.length < 30) return null
    const uint24 = (at: number) => data.getUint16(at, true) | ((bytes[at + 2] as number) << 16)
    return size(uint24(24) + 1, uint24(27) + 1)
  }
  return null
}

/**
 * Identifies a file by its magic bytes, and for images reads the pixel size from the header. An
 * unknown type is null — the caller then falls back to the declared type and the slot's policy.
 * The server never decodes pixels.
 */
export function sniffType(bytes: Uint8Array): SniffedType | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return { mime: 'image/png', image: pngSize(bytes) }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', image: jpegSize(bytes) }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return { mime: 'image/webp', image: webpSize(bytes) }
  }
  const gif = ascii(bytes, 0, 6)
  if (gif === 'GIF87a' || gif === 'GIF89a') return { mime: 'image/gif', image: gifSize(bytes) }
  if (ascii(bytes, 0, 5) === '%PDF-') return { mime: 'application/pdf', image: null }
  return null
}
