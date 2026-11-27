import { beforeAll, describe, expect, it } from 'vitest'

import { ImageDecodeError, decodeImage, encodeWebp, initImageCodecs, wasmFileName } from './index'
import { packageWasmLoader } from './node'
import { encodeJpeg, encodePng, gradientImage } from './testing'

beforeAll(async () => {
  expect(await initImageCodecs(packageWasmLoader, { webpEncoder: true })).toBeUndefined()
})

describe('image codecs in Node', () => {
  it('encodes WebP and decodes it back at the same size', async () => {
    const webp = await encodeWebp(gradientImage(256, 256), { quality: 86 })
    if (webp instanceof Error) throw webp
    expect(new TextDecoder().decode(webp.subarray(8, 12))).toBe('WEBP')

    const decoded = await decodeImage(webp, 'image/webp')
    if (decoded instanceof Error) throw decoded
    expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 256, height: 256 })
    expect(decoded.data).toHaveLength(256 * 256 * 4)
  })

  it('decodes a PNG to its exact pixels', async () => {
    const decoded = await decodeImage(encodePng(3, 2), 'image/png')
    if (decoded instanceof Error) throw decoded
    expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 3, height: 2 })
    expect([...decoded.data]).toEqual([...gradientImage(3, 2).data])
  })

  it('decodes a JPEG', async () => {
    const decoded = await decodeImage(await encodeJpeg(40, 30), 'image/jpeg')
    if (decoded instanceof Error) throw decoded
    expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 40, height: 30 })
  })

  it('rejects a PNG whose header is intact but whose body is cut off', async () => {
    const png = encodePng(64, 64)
    expect(await decodeImage(png.subarray(0, 40), 'image/png')).toBeInstanceOf(ImageDecodeError)
  })

  it('rejects bytes of another type, and a type it cannot decode', async () => {
    const png = encodePng(4, 4)
    expect(await decodeImage(png, 'image/webp')).toBeInstanceOf(ImageDecodeError)
    expect(await decodeImage(png, 'image/jpeg')).toBeInstanceOf(ImageDecodeError)
    expect(await decodeImage(png, 'image/gif')).toBeInstanceOf(ImageDecodeError)
  })

  it('names each shipped binary by its basename', () => {
    expect(wasmFileName('png-decode')).toBe('squoosh_png_bg.wasm')
    expect(wasmFileName('webp-encode-simd')).toBe('webp_enc_simd.wasm')
  })
})
