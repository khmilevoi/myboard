/**
 * Hand-built file headers. They are only as long as the sniffer needs (plus a little padding), not
 * decodable images: the server never decodes pixels.
 */

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

function u16le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff]
}

function u24le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff]
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0))
}

function riff(chunk: number[]): number[] {
  return [...ascii('RIFF'), ...u32be(0), ...ascii('WEBP'), ...chunk]
}

export function pngBytes(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32be(13),
    ...ascii('IHDR'),
    ...u32be(width),
    ...u32be(height),
    8,
    6,
    0,
    0,
    0,
    ...u32be(0),
  ])
}

/** SOI, an APP0 segment, a DHT segment (must be skipped), then SOF0 with the size. */
export function jpegBytes(width: number, height: number, sofMarker = 0xc0): Uint8Array {
  const sizeHi = (v: number) => [(v >>> 8) & 0xff, v & 0xff]
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    ...ascii('JFIF'),
    0,
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    0xff,
    0xc4,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    sofMarker,
    0x00,
    0x11,
    8,
    ...sizeHi(height),
    ...sizeHi(width),
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
    0xff,
    0xd9,
  ])
}

export function webpLossyBytes(width: number, height: number): Uint8Array {
  return Uint8Array.from(
    riff([
      ...ascii('VP8 '),
      ...u32be(0),
      0x30,
      0x01,
      0x00,
      0x9d,
      0x01,
      0x2a,
      ...u16le(width),
      ...u16le(height),
      0,
      0,
    ]),
  )
}

export function webpLosslessBytes(width: number, height: number): Uint8Array {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)
  return Uint8Array.from(
    riff([
      ...ascii('VP8L'),
      ...u32be(0),
      0x2f,
      bits & 0xff,
      (bits >>> 8) & 0xff,
      (bits >>> 16) & 0xff,
      (bits >>> 24) & 0xff,
      0,
    ]),
  )
}

export function webpExtendedBytes(width: number, height: number): Uint8Array {
  return Uint8Array.from(
    riff([...ascii('VP8X'), ...u32be(0), 0x10, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)]),
  )
}

export const SVG_BYTES = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
)

export function gifBytes(width: number, height: number): Uint8Array {
  return Uint8Array.from([...ascii('GIF89a'), ...u16le(width), ...u16le(height), 0, 0, 0])
}

export const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n%âã\n1 0 obj\n<<>>\nendobj\n')
