import { afterEach, describe, expect, it, vi } from 'vitest'

import { ImagePrepareError, imageTarget, prepareImage } from './prepare-image'

type DrawCall = number[]

/** Records every surface: its size, what was drawn, and the encode requests. */
function stubOffscreenCanvas(encodesAs: (type: string) => string | null) {
  const surfaces: { width: number; height: number; draws: DrawCall[]; fills: number }[] = []
  class FakeOffscreenCanvas {
    readonly record: (typeof surfaces)[number]
    constructor(width: number, height: number) {
      this.record = { width, height, draws: [], fills: 0 }
      surfaces.push(this.record)
    }
    getContext() {
      const record = this.record
      return {
        fillStyle: '',
        fillRect: () => {
          record.fills += 1
        },
        drawImage: (_image: unknown, ...args: number[]) => {
          record.draws.push(args)
        },
      }
    }
    async convertToBlob({ type }: { type: string }) {
      const actual = encodesAs(type)
      return actual === null ? null : new Blob(['x'], { type: actual })
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
  it('decodes with EXIF orientation, draws the crop and encodes WebP', async () => {
    const { decode, close } = stubBitmap(4000, 3000)
    const surfaces = stubOffscreenCanvas((type) => type)
    const file = new Blob(['raw'], { type: 'image/jpeg' })

    const result = await prepareImage(file, 'avatar')

    expect(result).toBeInstanceOf(Blob)
    expect((result as Blob).type).toBe('image/webp')
    expect(decode).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' })
    expect(surfaces).toEqual([
      { width: 256, height: 256, draws: [[500, 0, 3000, 3000, 0, 0, 256, 256]], fills: 0 },
    ])
    expect(close).toHaveBeenCalled()
  })

  it('falls back to JPEG over white when the browser cannot encode WebP', async () => {
    stubBitmap(800, 600)
    // Safari < 17 ignores the requested type and hands back PNG.
    const surfaces = stubOffscreenCanvas((type) => (type === 'image/webp' ? 'image/png' : type))

    const result = await prepareImage(new Blob(['raw']), 'picture')

    expect((result as Blob).type).toBe('image/jpeg')
    expect(surfaces).toHaveLength(2)
    expect(surfaces[1]).toMatchObject({ width: 800, height: 600, fills: 1 })
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
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubBitmap(10, 10)
    stubOffscreenCanvas(() => null)
    expect(await prepareImage(new Blob(['raw']), 'avatar')).toBeInstanceOf(ImagePrepareError)
  })

  it('uses a DOM canvas when OffscreenCanvas is missing', async () => {
    stubBitmap(300, 300)
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
      fillRect: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      function (this: HTMLCanvasElement, callback, type) {
        callback(new Blob(['x'], { type }))
      },
    )

    const result = await prepareImage(new Blob(['raw']), 'avatar')
    expect((result as Blob).type).toBe('image/webp')
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 300, 300, 0, 0, 256, 256)
  })
})
