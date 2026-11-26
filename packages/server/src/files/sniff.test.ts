import { describe, expect, it } from 'vitest'

import {
  PDF_BYTES,
  SVG_BYTES,
  gifBytes,
  jpegBytes,
  pngBytes,
  webpExtendedBytes,
  webpLosslessBytes,
  webpLossyBytes,
} from '../test/file-fixtures'
import { isSniffableMime, sniffType } from './sniff'

describe('sniffType', () => {
  it.each([
    ['png', pngBytes, 'image/png'],
    ['jpeg', jpegBytes, 'image/jpeg'],
    ['gif', gifBytes, 'image/gif'],
    ['webp lossy', webpLossyBytes, 'image/webp'],
    ['webp lossless', webpLosslessBytes, 'image/webp'],
    ['webp extended', webpExtendedBytes, 'image/webp'],
  ] as const)('reads %s type and size', (_name, build, mime) => {
    expect(sniffType(build(1, 1))).toEqual({ mime, image: { width: 1, height: 1 } })
    expect(sniffType(build(640, 480))).toEqual({ mime, image: { width: 640, height: 480 } })
    expect(sniffType(build(300, 1200))).toEqual({ mime, image: { width: 300, height: 1200 } })
  })

  it('reads progressive and other SOF markers but skips DHT', () => {
    expect(sniffType(jpegBytes(20, 10, 0xc2))).toEqual({
      mime: 'image/jpeg',
      image: { width: 20, height: 10 },
    })
  })

  it('reads a large VP8X canvas', () => {
    expect(sniffType(webpExtendedBytes(5000, 3000))?.image).toEqual({ width: 5000, height: 3000 })
  })

  it('recognizes a pdf, without image dimensions', () => {
    expect(sniffType(PDF_BYTES)).toEqual({ mime: 'application/pdf', image: null })
  })

  it.each([
    ['svg', SVG_BYTES],
    ['empty', new Uint8Array()],
    ['text', new TextEncoder().encode('hello world, not a known type')],
  ])('does not recognize %s', (_name, bytes) => {
    expect(sniffType(bytes)).toBeNull()
  })

  it.each([
    ['png', pngBytes(4, 4).subarray(0, 20), 'image/png'],
    ['jpeg', jpegBytes(4, 4).subarray(0, 30), 'image/jpeg'],
    ['gif', gifBytes(4, 4).subarray(0, 8), 'image/gif'],
    ['webp lossy', webpLossyBytes(4, 4).subarray(0, 27), 'image/webp'],
    ['webp lossless', webpLosslessBytes(4, 4).subarray(0, 22), 'image/webp'],
    ['webp extended', webpExtendedBytes(4, 4).subarray(0, 26), 'image/webp'],
  ])('keeps the type of a truncated %s but drops its size', (_name, bytes, mime) => {
    expect(sniffType(bytes)).toEqual({ mime, image: null })
  })

  it('has no size for a zero-sized png or a JPEG that scans before its frame header', () => {
    expect(sniffType(pngBytes(0, 10))?.image).toBeNull()
    const early = Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9])
    expect(sniffType(early)).toEqual({ mime: 'image/jpeg', image: null })
  })

  it('lists exactly the sniffable types', () => {
    expect(isSniffableMime('application/pdf')).toBe(true)
    expect(isSniffableMime('image/gif')).toBe(true)
    expect(isSniffableMime('image/svg+xml')).toBe(false)
    expect(isSniffableMime('text/plain')).toBe(false)
  })
})
