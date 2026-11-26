import { FileImageRuleError } from '@shared/files/image-rules'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ImagePrepareError, imageTarget, prepareImage, readImageSize } from './prepare-image'

// jsdom has neither a real canvas nor WebAssembly codecs worth running here: the encoder is
// mocked, and the canvas stub hands back zeroed pixels of the requested size.
const codec = vi.hoisted(() => ({
  encodeWebp: vi.fn(
    async (_image: unknown, _options: unknown): Promise<Uint8Array | Error> =>
      Uint8Array.from([0x52, 0x49, 0x46, 0x46]),
  ),
}))
vi.mock('image-codec', () => codec)

type DrawCall = number[]

/** Records every surface: its size and what was drawn on it. */
function stubOffscreenCanvas() {
  const surfaces: { width: number; height: number; draws: DrawCall[] }[] = []
  class FakeOffscreenCanvas {
    readonly record: (typeof surfaces)[number]
    constructor(width: number, height: number) {
      this.record = { width, height, draws: [] }
      surfaces.push(this.record)
    }
    getContext() {
      const record = this.record
      return {
        drawImage: (_image: unknown, ...args: number[]) => {
          record.draws.push(args)
        },
        getImageData: (_x: number, _y: number, width: number, height: number) => ({
          width,
          height,
          data: new Uint8ClampedArray(width * height * 4),
        }),
      }
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
  return surfaces
}

function stubBitmap(width: number, height: number) {
  const close = vi.fn()
  const decode = vi.fn(async () => ({ width, height, close }))
  vi.stubGlobal('createImageBitmap', decode)
  return { decode, close }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  codec.encodeWebp.mockClear()
})

describe('imageTarget', () => {
  it('crops the centred square of a landscape photo for an avatar', () => {
    expect(imageTarget('avatar', 4000, 3000)).toEqual({
      sx: 500,
      sy: 0,
      sw: 3000,
      sh: 3000,
      width: 256,
      height: 256,
    })
  })

  it('crops the centred square of a portrait photo for an avatar', () => {
    expect(imageTarget('avatar', 1001, 1500)).toMatchObject({ sx: 0, sy: 249, sw: 1001, sh: 1001 })
  })

  it('never upscales a small avatar', () => {
    expect(imageTarget('avatar', 100, 120)).toMatchObject({ sw: 100, width: 100, height: 100 })
  })

  it('keeps an explicit avatar crop square', () => {
    expect(imageTarget('avatar', 4000, 3000, { x: 1200, y: 400, size: 1800 })).toEqual({
      sx: 1200,
      sy: 400,
      sw: 1800,
      sh: 1800,
      width: 256,
      height: 256,
    })
  })

  it('clamps an avatar crop that overhangs the image', () => {
    expect(imageTarget('avatar', 4000, 3000, { x: 3500, y: -20, size: 5000 })).toMatchObject({
      sx: 1000,
      sy: 0,
      sw: 3000,
      sh: 3000,
    })
    expect(imageTarget('avatar', 400, 300, { x: 350.4, y: 280.6, size: 99.6 })).toMatchObject({
      sx: 300,
      sy: 200,
      sw: 100,
      width: 100,
    })
  })

  it('never lets an avatar crop collapse below one pixel', () => {
    expect(imageTarget('avatar', 50, 50, { x: 10, y: 10, size: 0 })).toMatchObject({
      sw: 1,
      width: 1,
    })
  })

  it('ignores a crop for the picture preset', () => {
    expect(imageTarget('picture', 800, 600, { x: 10, y: 10, size: 100 })).toMatchObject({
      sx: 0,
      sw: 800,
    })
  })

  it('scales a picture so its longest side is 1600', () => {
    expect(imageTarget('picture', 4000, 3000)).toEqual({
      sx: 0,
      sy: 0,
      sw: 4000,
      sh: 3000,
      width: 1600,
      height: 1200,
    })
  })

  it('never upscales a small picture', () => {
    expect(imageTarget('picture', 800, 600)).toMatchObject({ width: 800, height: 600 })
  })
})

describe('prepareImage', () => {
  it('decodes with EXIF orientation, draws the crop and encodes WebP with jSquash', async () => {
    const { decode, close } = stubBitmap(4000, 3000)
    const surfaces = stubOffscreenCanvas()
    const file = new Blob(['raw'], { type: 'image/jpeg' })

    const result = await prepareImage(file, 'avatar')

    expect(result).toBeInstanceOf(Blob)
    expect((result as Blob).type).toBe('image/webp')
    expect((result as Blob).size).toBe(4)
    expect(decode).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' })
    expect(surfaces).toEqual([
      { width: 256, height: 256, draws: [[500, 0, 3000, 3000, 0, 0, 256, 256]] },
    ])
    expect(codec.encodeWebp).toHaveBeenCalledWith(
      { width: 256, height: 256, data: expect.any(Uint8ClampedArray) },
      { quality: 86 },
    )
    expect(close).toHaveBeenCalled()
  })

  it('draws an explicit crop from the same oriented bitmap', async () => {
    const { decode } = stubBitmap(3000, 4000)
    const surfaces = stubOffscreenCanvas()

    await prepareImage(new Blob(['raw']), 'avatar', { crop: { x: 100, y: 900, size: 2000 } })

    expect(decode).toHaveBeenCalledWith(expect.anything(), { imageOrientation: 'from-image' })
    expect(surfaces[0]?.draws).toEqual([[100, 900, 2000, 2000, 0, 0, 256, 256]])
  })

  it('encodes a picture at its scaled size with no rules by default', async () => {
    stubBitmap(800, 600)
    stubOffscreenCanvas()

    const result = await prepareImage(new Blob(['raw']), 'picture')

    expect((result as Blob).type).toBe('image/webp')
    expect(codec.encodeWebp).toHaveBeenCalledWith(
      expect.objectContaining({ width: 800, height: 600 }),
      { quality: 86 },
    )
  })

  it('returns the broken image rule before encoding anything', async () => {
    stubBitmap(100, 120)
    stubOffscreenCanvas()
    const policy = { accept: ['image/webp'], maxBytes: 1000, image: { minSide: 200 } }

    const result = await prepareImage(new Blob(['raw']), 'avatar', { policy })

    expect(result).toBeInstanceOf(FileImageRuleError)
    expect((result as FileImageRuleError).reason).toBe('too_small')
    expect(codec.encodeWebp).not.toHaveBeenCalled()
  })

  it('checks a picture against the policy it is given', async () => {
    stubBitmap(800, 600)
    stubOffscreenCanvas()
    const policy = { accept: ['image/*'], maxBytes: 1000, image: { square: true } }

    const result = await prepareImage(new Blob(['raw']), 'picture', { policy })

    expect((result as FileImageRuleError).reason).toBe('not_square')
  })

  it('returns an ImagePrepareError when the file cannot be decoded', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new DOMException('bad image', 'InvalidStateError')
      }),
    )
    const result = await prepareImage(new Blob(['not an image']), 'avatar')
    expect(result).toBeInstanceOf(ImagePrepareError)
  })

  it('returns an ImagePrepareError when encoding fails', async () => {
    stubBitmap(10, 10)
    stubOffscreenCanvas()
    codec.encodeWebp.mockResolvedValueOnce(new Error('wasm failed'))
    expect(await prepareImage(new Blob(['raw']), 'avatar')).toBeInstanceOf(ImagePrepareError)
  })

  it('returns an ImagePrepareError when createImageBitmap is missing', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    expect(await prepareImage(new Blob(['raw']), 'avatar')).toBeInstanceOf(ImagePrepareError)
  })

  it('uses a DOM canvas when OffscreenCanvas is missing', async () => {
    stubBitmap(300, 300)
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
    } as unknown as CanvasRenderingContext2D)

    const result = await prepareImage(new Blob(['raw']), 'avatar')
    expect((result as Blob).type).toBe('image/webp')
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 300, 300, 0, 0, 256, 256)
  })
})

describe('readImageSize', () => {
  it('measures the oriented bitmap and releases it', async () => {
    const { decode, close } = stubBitmap(3000, 4000)
    const file = new Blob(['raw'])

    expect(await readImageSize(file)).toEqual({ width: 3000, height: 4000 })
    expect(decode).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' })
    expect(close).toHaveBeenCalled()
  })

  it('returns an ImagePrepareError for an unreadable file', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new DOMException('bad image', 'InvalidStateError')
      }),
    )
    expect(await readImageSize(new Blob(['x']))).toBeInstanceOf(ImagePrepareError)
  })
})
