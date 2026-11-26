import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import zlib from 'node:zlib'

import type { DecodedImage } from './index'

/**
 * Real, decodable fixtures for tests in Node — built at test time, so no binary lives in git.
 * Node-only (`node:zlib`); never import it from browser code.
 */

/** A deterministic RGBA gradient, so an encoder has something other than one flat colour. */
export function gradientImage(width: number, height: number): DecodedImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4
      data[at] = (x * 255) / Math.max(1, width - 1)
      data[at + 1] = (y * 255) / Math.max(1, height - 1)
      data[at + 2] = 128
      data[at + 3] = 255
    }
  }
  return { width, height, data }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(body, 8)
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
  return out
}

/** A complete 8-bit RGBA PNG of `gradientImage(width, height)`. */
export function encodePng(width: number, height: number): Uint8Array<ArrayBuffer> {
  const { data } = gradientImage(width, height)
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 6, 0, 0, 0], 8)
  // Every scanline is prefixed with filter type 0 (none).
  const raw = new Uint8Array(height * (width * 4 + 1))
  for (let y = 0; y < height; y += 1) {
    raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  }
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(zlib.deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  parts.reduce((at, part) => (out.set(part, at), at + part.length), 0)
  return out
}

const require = createRequire(import.meta.url)
let jpegEncoderReady: Promise<void> | null = null

/** A baseline JPEG of `gradientImage(width, height)`, through jSquash's MozJPEG encoder. */
export async function encodeJpeg(width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
  const encoder = await import('@jsquash/jpeg/encode.js')
  jpegEncoderReady ??= (async () => {
    const wasm = await fs.readFile(require.resolve('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'))
    await (encoder.init as (module: WebAssembly.Module) => Promise<void>)(
      await WebAssembly.compile(wasm),
    )
  })()
  await jpegEncoderReady
  const image = gradientImage(width, height) as unknown as Parameters<typeof encoder.default>[0]
  return new Uint8Array(await encoder.default(image, { quality: 80 }))
}
