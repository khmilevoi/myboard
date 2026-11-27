import { context } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  circleDiameter,
  clampCenter,
  cropRect,
  cropSide,
  imageLayout,
  makeAvatarCropModel,
  zoomAround,
} from './avatar-crop-model'

afterEach(() => context.reset())

const LANDSCAPE = { width: 4000, height: 3000 }

/** The caller's copy for a failed upload; the account menu passes `describeAvatarError`. */
const describeError = (error: Error) => `Не сохранилось: ${error.message}`

describe('crop math', () => {
  it('starts from the largest square and narrows it with zoom', () => {
    expect(cropSide(LANDSCAPE, 1)).toBe(3000)
    expect(cropSide(LANDSCAPE, 2)).toBe(1500)
    // Out-of-range zoom is clamped to 1…3.
    expect(cropSide(LANDSCAPE, 0.2)).toBe(3000)
    expect(cropSide(LANDSCAPE, 9)).toBe(1000)
  })

  it('keeps the selection inside the image so the circle is always covered', () => {
    expect(clampCenter(LANDSCAPE, 3000, { x: 0, y: 9999 })).toEqual({ x: 1500, y: 1500 })
    expect(clampCenter(LANDSCAPE, 3000, { x: 9999, y: -5 })).toEqual({ x: 2500, y: 1500 })
    expect(clampCenter(LANDSCAPE, 1000, { x: 700, y: 2000 })).toEqual({ x: 700, y: 2000 })
  })

  it('turns the selection into the square prepareImage keeps', () => {
    expect(cropRect(1000, { x: 700, y: 2000 })).toEqual({ x: 200, y: 1500, size: 1000 })
  })

  it('keeps the point under the anchor still while zooming', () => {
    const before = { zoom: 1, center: { x: 2000, y: 1500 } }
    const anchor = { x: 55, y: -30 }
    const next = zoomAround({ image: LANDSCAPE, ...before, circle: 220, nextZoom: 2, anchor })

    const sourceUnder = (zoom: number, center: { x: number; y: number }) => {
      const scale = 220 / cropSide(LANDSCAPE, zoom)
      return { x: center.x + anchor.x / scale, y: center.y + anchor.y / scale }
    }
    expect(next.zoom).toBe(2)
    const a = sourceUnder(before.zoom, before.center)
    const b = sourceUnder(next.zoom, next.center)
    expect(b.x).toBeCloseTo(a.x)
    expect(b.y).toBeCloseTo(a.y)
  })

  it('zooms about the centre without an anchor offset and clamps when zooming out', () => {
    const zoomedIn = zoomAround({
      image: LANDSCAPE,
      zoom: 1,
      center: { x: 2000, y: 1500 },
      circle: 220,
      nextZoom: 3,
      anchor: { x: 0, y: 0 },
    })
    expect(zoomedIn.center).toEqual({ x: 2000, y: 1500 })

    // A corner selection at zoom 3 must slide back inside when the square grows again.
    const zoomedOut = zoomAround({
      image: LANDSCAPE,
      zoom: 3,
      center: { x: 500, y: 500 },
      circle: 220,
      nextZoom: 1,
      anchor: { x: 0, y: 0 },
    })
    expect(zoomedOut).toEqual({ zoom: 1, center: { x: 1500, y: 1500 } })
  })

  it('lays the image out so the selection fills the circle', () => {
    expect(
      imageLayout({
        image: LANDSCAPE,
        side: 3000,
        center: { x: 2000, y: 1500 },
        box: { width: 428, height: 300 },
        circle: 220,
      }),
    ).toEqual({
      left: 214 - 2000 * (220 / 3000),
      top: 150 - 1500 * (220 / 3000),
      width: 4000 * (220 / 3000),
      height: 220,
    })
    // A 44 px preview: box and circle are the preview itself.
    const preview = imageLayout({
      image: LANDSCAPE,
      side: 1000,
      center: { x: 700, y: 2000 },
      box: { width: 44, height: 44 },
      circle: 44,
    })
    expect(preview.width).toBeCloseTo(176)
    expect(preview.left).toBeCloseTo(22 - 700 * 0.044)
  })

  it('shrinks the circle only on a stage too small for 220 px', () => {
    expect(circleDiameter({ width: 428, height: 300 })).toBe(220)
    expect(circleDiameter({ width: 200, height: 300 })).toBe(168)
  })
})

function makeModel(
  options: {
    size?: { width: number; height: number } | Error
    upload?: (file: Blob, crop: { x: number; y: number; size: number }) => Promise<Error | null>
  } = {},
) {
  const upload = vi.fn(options.upload ?? (async () => null))
  const revokeObjectUrl = vi.fn()
  let urls = 0
  const model = makeAvatarCropModel({
    upload,
    describeError,
    readImageSize: async () => options.size ?? LANDSCAPE,
    createObjectUrl: () => `blob:photo-${++urls}`,
    revokeObjectUrl,
  })
  return { model, upload, revokeObjectUrl }
}

describe('makeAvatarCropModel', () => {
  it('opens on the centred, fully covering square', async () => {
    const { model } = makeModel()

    await model.openFile(new Blob(['jpeg']))

    expect(model.open()).toBe(true)
    expect(model.phase()).toBe('ready')
    expect(model.image()).toMatchObject({ url: 'blob:photo-1', width: 4000, height: 3000 })
    expect(model.crop()).toEqual({ x: 500, y: 0, size: 3000 })
  })

  it('pans by a pointer delta, clamped so the circle stays covered', async () => {
    const { model } = makeModel()
    await model.openFile(new Blob(['jpeg']))

    // 220 px circle over a 3000 px square: one screen px is 3000/220 source px.
    model.pan(-22, 0)
    expect(model.crop()?.x).toBeCloseTo(500 + 300)
    model.pan(0, 50)
    // Vertically there is no slack at zoom 1.
    expect(model.crop()?.y).toBe(0)
    model.pan(-10_000, 0)
    expect(model.crop()).toEqual({ x: 1000, y: 0, size: 3000 })
  })

  it('zooms from the slider and wheel within 1…3', async () => {
    const { model } = makeModel()
    await model.openFile(new Blob(['jpeg']))

    model.zoomTo(2)
    expect(model.zoom()).toBe(2)
    expect(model.crop()).toEqual({ x: 1250, y: 750, size: 1500 })

    model.zoomBy(10, { x: 40, y: 40 })
    expect(model.zoom()).toBe(3)
    model.zoomBy(0.01)
    expect(model.zoom()).toBe(1)
  })

  it('nudges with arrows, further with Shift, and steps the zoom from the keyboard', async () => {
    const { model } = makeModel()
    await model.openFile(new Blob(['jpeg']))
    // Zoomed in, so there is room to move both ways.
    model.zoomTo(2)
    const start = model.crop()!.x

    model.nudge('left', false)
    const small = model.crop()!.x - start
    model.nudge('left', true)
    const large = model.crop()!.x - start - small
    // Arrow left moves the photo left, so the selection slides right.
    expect(small).toBeGreaterThan(0)
    expect(large).toBeCloseTo(small * 5)

    model.stepZoom(1)
    expect(model.zoom()).toBeCloseTo(2.1)
    model.zoomTo(1.05)
    model.stepZoom(-1)
    expect(model.zoom()).toBe(1)
  })

  it('opens in the unreadable state without a stage when the file does not decode', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { model } = makeModel({ size: new Error('decode') })

    await model.openFile(new Blob(['heic']))

    expect(model.open()).toBe(true)
    expect(model.phase()).toBe('unreadable')
    expect(model.image()).toBeNull()
    expect(model.error()).toBe('Не получилось прочитать файл. Выберите фото в JPEG, PNG или WebP.')
  })

  it('saves the selected square, then closes and revokes the preview URL', async () => {
    const { model, upload, revokeObjectUrl } = makeModel()
    const file = new Blob(['jpeg'])
    await model.openFile(file)
    model.zoomTo(2)

    await model.save()

    expect(upload).toHaveBeenCalledWith(file, { x: 1250, y: 750, size: 1500 })
    expect(model.open()).toBe(false)
    expect(model.image()).toBeNull()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:photo-1')
  })

  it('keeps the dialog, the selection and the copy when the save fails', async () => {
    const { model } = makeModel({
      upload: async () => new Error('слишком большое'),
    })
    await model.openFile(new Blob(['jpeg']))
    model.zoomTo(2)

    await model.save()

    expect(model.open()).toBe(true)
    expect(model.error()).toBe('Не сохранилось: слишком большое')
    expect(model.crop()).toEqual({ x: 1250, y: 750, size: 1500 })
  })

  it('cannot be closed or moved while saving', async () => {
    let finish: (value: Error | null) => void = () => {}
    const { model } = makeModel({ upload: () => new Promise((resolve) => (finish = resolve)) })
    await model.openFile(new Blob(['jpeg']))

    const saving = model.save()
    expect(model.saving()).toBe(true)
    model.close()
    model.pan(-50, 0)
    expect(model.open()).toBe(true)
    expect(model.crop()?.x).toBe(500)

    finish(null)
    await saving
    expect(model.saving()).toBe(false)
    expect(model.open()).toBe(false)
  })

  it('revokes the previous URL when another file replaces it, and on close', async () => {
    const { model, revokeObjectUrl } = makeModel()
    await model.openFile(new Blob(['one']))
    await model.openFile(new Blob(['two']))
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:photo-1')
    expect(model.image()?.url).toBe('blob:photo-2')

    model.close()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:photo-2')
    expect(model.open()).toBe(false)
    expect(model.error()).toBeNull()
  })

  it('drops a decode that finishes after a newer pick', async () => {
    let releaseFirst: (size: { width: number; height: number }) => void = () => {}
    const first = new Blob(['first'])
    const model = makeAvatarCropModel({
      upload: async () => null,
      describeError,
      readImageSize: (file) =>
        file === first
          ? new Promise((resolve) => (releaseFirst = resolve))
          : Promise.resolve({ width: 100, height: 200 }),
      createObjectUrl: () => 'blob:x',
      revokeObjectUrl: () => {},
    })

    const slow = model.openFile(first)
    await model.openFile(new Blob(['second']))
    releaseFirst(LANDSCAPE)
    await slow

    expect(model.image()).toMatchObject({ width: 100, height: 200 })
  })
})
