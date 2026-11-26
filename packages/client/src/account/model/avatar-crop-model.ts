import {
  action,
  type Action,
  atom,
  type Atom,
  type Computed,
  computed,
  wrap,
  withAsync,
} from '@reatom/core'
import {
  readImageSize as readImageSizeInBrowser,
  type SquareCrop,
} from 'widget-sdk/files/prepare-image'

import { describeAvatarError } from './avatar-http'

/**
 * The avatar crop dialog (design page 03, section 1d). Every position here lives in the pixels of
 * the decoded, EXIF-oriented image — the same space `prepareImage` crops in — so the stage, the
 * previews and the saved file can never disagree about what is inside the circle.
 *
 * The selection is a square of `side` source pixels centred on `center`. Zoom 1 is the largest
 * square the image allows (the photo just covers the circle); zoom 3 is a third of that.
 */

export const MIN_ZOOM = 1
export const MAX_ZOOM = 3
/** The circle's diameter on a stage wide enough for it — design 1d. */
export const CIRCLE_DIAMETER = 220
/** The smallest margin kept between the circle and the stage edge on a narrow stage. */
const CIRCLE_MARGIN = 16
const NUDGE_STEP = 10
const NUDGE_STEP_LARGE = 50
const KEY_ZOOM_STEP = 0.1

export type Size = { width: number; height: number }
export type Point = { x: number; y: number }
export type NudgeDirection = 'left' | 'right' | 'up' | 'down'

/** Where to draw the whole image inside a box so the selection fills the box's circle. */
export type ImageLayout = { left: number; top: number; width: number; height: number }

export type CropImage = Size & { file: Blob; url: string }

export type CropPhase = 'decoding' | 'ready' | 'unreadable'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function clampZoom(zoom: number): number {
  return Number.isFinite(zoom) ? clamp(zoom, MIN_ZOOM, MAX_ZOOM) : MIN_ZOOM
}

/** The selection's side in source pixels at `zoom`. */
export function cropSide(image: Size, zoom: number): number {
  return Math.min(image.width, image.height) / clampZoom(zoom)
}

/** Keeps the selection square inside the image, so the circle is always fully covered. */
export function clampCenter(image: Size, side: number, center: Point): Point {
  const half = side / 2
  return {
    x: clamp(center.x, half, image.width - half),
    y: clamp(center.y, half, image.height - half),
  }
}

/** The selection as the square `prepareImage` keeps. */
export function cropRect(side: number, center: Point): SquareCrop {
  return { x: center.x - side / 2, y: center.y - side / 2, size: side }
}

/** The circle that fits a stage: the design's 220 px, smaller only on a stage too small for it. */
export function circleDiameter(stage: Size): number {
  return Math.max(
    1,
    Math.min(CIRCLE_DIAMETER, stage.width - 2 * CIRCLE_MARGIN, stage.height - 2 * CIRCLE_MARGIN),
  )
}

/**
 * Changes zoom while the source point under `anchor` stays put. `anchor` is in screen pixels
 * relative to the circle's centre (the stage centre); `{ x: 0, y: 0 }` zooms about the centre.
 */
export function zoomAround(input: {
  image: Size
  zoom: number
  center: Point
  circle: number
  nextZoom: number
  anchor: Point
}): { zoom: number; center: Point } {
  const { image, zoom, center, circle, anchor } = input
  const nextZoom = clampZoom(input.nextZoom)
  const side = cropSide(image, zoom)
  const nextSide = cropSide(image, nextZoom)
  // Screen px per source px before and after.
  const scale = circle / side
  const nextScale = circle / nextSide
  const pinned = { x: center.x + anchor.x / scale, y: center.y + anchor.y / scale }
  return {
    zoom: nextZoom,
    center: clampCenter(image, nextSide, {
      x: pinned.x - anchor.x / nextScale,
      y: pinned.y - anchor.y / nextScale,
    }),
  }
}

/**
 * Positions the whole image in a `box` whose centred circle of `circle` px shows exactly the
 * selection. The stage uses it with its own size; a preview with box = circle = its diameter.
 */
export function imageLayout(input: {
  image: Size
  side: number
  center: Point
  box: Size
  circle: number
}): ImageLayout {
  const { image, side, center, box, circle } = input
  const scale = circle / side
  return {
    left: box.width / 2 - center.x * scale,
    top: box.height / 2 - center.y * scale,
    width: image.width * scale,
    height: image.height * scale,
  }
}

export type AvatarCropDeps = {
  /** Uploads the crop and applies it everywhere — `AccountModel.uploadAvatar`. */
  upload: (file: Blob, crop: SquareCrop) => Promise<Error | null>
  /** Measures the oriented image; an error means the dialog opens in its "unreadable" state. */
  readImageSize: (file: Blob) => Promise<Error | Size>
  createObjectUrl: (file: Blob) => string
  revokeObjectUrl: (url: string) => void
}

export interface AvatarCropModel {
  open: Atom<boolean>
  phase: Atom<CropPhase>
  image: Atom<CropImage | null>
  zoom: Atom<number>
  center: Atom<Point>
  /** The stage's measured size; the UI keeps it current. */
  stage: Atom<Size>
  circle: Computed<number>
  side: Computed<number>
  crop: Computed<SquareCrop | null>
  /** Where the stage draws the image; null until an image is decoded. */
  stageLayout: Computed<ImageLayout | null>
  /** User-facing copy of the last failure: unreadable file or failed save. */
  error: Atom<string | null>
  saving: Computed<boolean>
  openFile: Action<[Blob], Promise<void>>
  close: Action<[], void>
  pan: Action<[number, number], void>
  zoomTo: Action<[number, Point?], void>
  zoomBy: Action<[number, Point?], void>
  nudge: Action<[NudgeDirection, boolean], void>
  /** Keyboard zoom: one slider step in or out. */
  stepZoom: Action<[1 | -1], void>
  save: Action<[], Promise<void>>
}

const UNREADABLE_COPY = 'Не получилось прочитать файл. Выберите фото в JPEG, PNG или WebP.'
const DEFAULT_STAGE: Size = { width: 428, height: 300 }

export function makeAvatarCropModel(
  overrides: Partial<AvatarCropDeps> & Pick<AvatarCropDeps, 'upload'>,
): AvatarCropModel {
  const deps: AvatarCropDeps = {
    upload: overrides.upload,
    readImageSize: overrides.readImageSize ?? readImageSizeInBrowser,
    createObjectUrl: overrides.createObjectUrl ?? ((file) => URL.createObjectURL(file)),
    revokeObjectUrl: overrides.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url)),
  }

  const open = atom(false, 'avatarCrop.open')
  const phase = atom<CropPhase>('decoding', 'avatarCrop.phase')
  const image = atom<CropImage | null>(null, 'avatarCrop.image')
  const zoom = atom(MIN_ZOOM, 'avatarCrop.zoom')
  const center = atom<Point>({ x: 0, y: 0 }, 'avatarCrop.center')
  const stage = atom<Size>(DEFAULT_STAGE, 'avatarCrop.stage')
  const error = atom<string | null>(null, 'avatarCrop.error')
  // The file whose decode is current: a second pick while the first still decodes wins.
  const picked = atom<Blob | null>(null, 'avatarCrop.picked')

  const circle = computed(() => circleDiameter(stage()), 'avatarCrop.circle')

  const side = computed(() => {
    const current = image()
    return current === null ? 1 : cropSide(current, zoom())
  }, 'avatarCrop.side')

  const crop = computed(
    () => (image() === null ? null : cropRect(side(), center())),
    'avatarCrop.crop',
  )

  const stageLayout = computed(() => {
    const current = image()
    if (current === null) return null
    return imageLayout({
      image: current,
      side: side(),
      center: center(),
      box: stage(),
      circle: circle(),
    })
  }, 'avatarCrop.stageLayout')

  const releaseImage = action(() => {
    const current = image()
    if (current !== null) deps.revokeObjectUrl(current.url)
    image.set(null)
  }, 'avatarCrop.releaseImage')

  const openFile = action(async (file: Blob) => {
    releaseImage()
    picked.set(file)
    error.set(null)
    phase.set('decoding')
    open.set(true)

    const size = await wrap(deps.readImageSize(file))
    if (picked() !== file || !open()) return
    if (size instanceof Error) {
      console.warn('[avatarCrop] the picked file is not a readable image', size)
      error.set(UNREADABLE_COPY)
      phase.set('unreadable')
      return
    }

    image.set({ file, url: deps.createObjectUrl(file), width: size.width, height: size.height })
    zoom.set(MIN_ZOOM)
    center.set({ x: size.width / 2, y: size.height / 2 })
    phase.set('ready')
  }, 'avatarCrop.openFile')

  const save = action(async () => {
    const current = image()
    const selection = crop()
    if (current === null || selection === null) return
    error.set(null)

    const result = await wrap(deps.upload(current.file, selection))
    if (result instanceof Error) {
      error.set(describeAvatarError(result))
      return
    }

    open.set(false)
    releaseImage()
    picked.set(null)
  }, 'avatarCrop.save').extend(withAsync())

  const saving = computed(() => !save.ready(), 'avatarCrop.saving')

  const close = action(() => {
    // The upload cannot be taken back mid-flight; the dialog stays until it settles.
    if (saving()) return
    open.set(false)
    releaseImage()
    picked.set(null)
    error.set(null)
  }, 'avatarCrop.close')

  const pan = action((dx: number, dy: number) => {
    const current = image()
    if (current === null || saving()) return
    const scale = circle() / side()
    const previous = center()
    center.set(
      clampCenter(current, side(), { x: previous.x - dx / scale, y: previous.y - dy / scale }),
    )
  }, 'avatarCrop.pan')

  const zoomTo = action((nextZoom: number, anchor: Point = { x: 0, y: 0 }) => {
    const current = image()
    if (current === null || saving()) return
    const next = zoomAround({
      image: current,
      zoom: zoom(),
      center: center(),
      circle: circle(),
      nextZoom,
      anchor,
    })
    zoom.set(next.zoom)
    center.set(next.center)
  }, 'avatarCrop.zoomTo')

  const zoomBy = action((factor: number, anchor?: Point) => {
    zoomTo(zoom() * factor, anchor)
  }, 'avatarCrop.zoomBy')

  const stepZoom = action((direction: 1 | -1) => {
    zoomTo(zoom() + direction * KEY_ZOOM_STEP)
  }, 'avatarCrop.stepZoom')

  // The arrow moves the photo the way a drag in that direction would.
  const nudge = action((direction: NudgeDirection, large: boolean) => {
    const step = large ? NUDGE_STEP_LARGE : NUDGE_STEP
    if (direction === 'left') pan(-step, 0)
    if (direction === 'right') pan(step, 0)
    if (direction === 'up') pan(0, -step)
    if (direction === 'down') pan(0, step)
  }, 'avatarCrop.nudge')

  return {
    open,
    phase,
    image,
    zoom,
    center,
    stage,
    circle,
    side,
    crop,
    stageLayout,
    error,
    saving,
    openFile,
    close,
    pan,
    zoomTo,
    zoomBy,
    nudge,
    stepZoom,
    save,
  }
}
