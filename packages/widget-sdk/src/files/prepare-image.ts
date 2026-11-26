import { AVATAR_POLICY, type FilePolicy } from '@shared/files/contract'
import { checkImageRules, type FileImageRuleError } from '@shared/files/image-rules'
import * as errore from 'errore'
import { encodeWebp, type DecodedImage } from 'image-codec'

/**
 * Browser-side image preparation before an upload: decode (honouring EXIF orientation), crop or
 * scale, re-encode as WebP. This is where a 12 MP photo becomes a few dozen kilobytes; the server
 * only decodes to verify an image-rule slot's upload, it never resizes. Image-only on purpose —
 * file slots accept any type, and other files are uploaded as they are.
 */

export type ImagePreset = 'avatar' | 'picture'

export class ImagePrepareError extends errore.createTaggedError({
  name: 'ImagePrepareError',
  message: 'Could not prepare the image: $reason',
}) {}

/** Source rectangle and output size of one preparation. */
export type ImageTarget = {
  sx: number
  sy: number
  sw: number
  sh: number
  width: number
  height: number
}

/**
 * An explicit square for the avatar preset, in the pixels of the oriented image — the bitmap that
 * `readImageSize` measures, which is the same one `prepareImage` decodes.
 */
export type SquareCrop = { x: number; y: number; size: number }

export type PrepareImageOptions = {
  /** Avatar only: the square to keep. Clamped to the image; omitted, the centred square. */
  crop?: SquareCrop
  /** The slot's policy whose image rules the result must meet; the avatar preset defaults it. */
  policy?: FilePolicy
}

const AVATAR_SIDE = 256
const PICTURE_LONGEST_SIDE = 1600
/** jSquash's WebP quality, 0–100. */
const QUALITY = 86

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function avatarSquare(width: number, height: number, crop: SquareCrop | undefined) {
  const shorter = Math.min(width, height)
  if (crop === undefined) {
    return {
      side: shorter,
      x: Math.floor((width - shorter) / 2),
      y: Math.floor((height - shorter) / 2),
    }
  }
  const side = clamp(Math.round(crop.size), 1, shorter)
  return {
    side,
    x: clamp(Math.round(crop.x), 0, width - side),
    y: clamp(Math.round(crop.y), 0, height - side),
  }
}

/**
 * `avatar`: the given `crop` square (clamped to the image) or else the centred square of the
 * shorter side, scaled to 256 px. `picture`: the whole image with its longest side at most
 * 1600 px. Neither ever upscales.
 */
export function imageTarget(
  preset: ImagePreset,
  width: number,
  height: number,
  crop?: SquareCrop,
): ImageTarget {
  if (preset === 'avatar') {
    const { side, x, y } = avatarSquare(width, height, crop)
    const out = Math.min(AVATAR_SIDE, side)
    return { sx: x, sy: y, sw: side, sh: side, width: out, height: out }
  }
  const scale = Math.min(1, PICTURE_LONGEST_SIDE / Math.max(width, height))
  return {
    sx: 0,
    sy: 0,
    sw: width,
    sh: height,
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

type Canvas2D = {
  drawImage(
    image: ImageBitmap,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData
}

function context2d(width: number, height: number): Canvas2D | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height).getContext('2d')
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas.getContext('2d')
}

/** Draws the crop at its output size and reads the pixels back for the encoder. */
function render(bitmap: ImageBitmap, target: ImageTarget): ImagePrepareError | DecodedImage {
  const context = context2d(target.width, target.height)
  if (!context) return new ImagePrepareError({ reason: 'no 2d canvas context' })
  const { sx, sy, sw, sh, width, height } = target
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height)
  const pixels = errore.try({
    try: () => context.getImageData(0, 0, width, height),
    catch: (cause) => new ImagePrepareError({ reason: 'the canvas pixels are unreadable', cause }),
  })
  if (pixels instanceof Error) return pixels
  const image: DecodedImage = { width, height, data: pixels.data }
  return image
}

/** The one decode both `readImageSize` and `prepareImage` use, EXIF orientation applied. */
async function decode(file: Blob): Promise<ImagePrepareError | ImageBitmap> {
  if (typeof createImageBitmap === 'undefined') {
    return new ImagePrepareError({ reason: 'createImageBitmap is unavailable' })
  }
  return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(
    (cause: unknown) =>
      new ImagePrepareError({ reason: 'the file is not a readable image', cause }),
  )
}

/**
 * The oriented size of `file` — the coordinate space a `SquareCrop` is written in. A crop UI
 * measures with this rather than with an `<img>`, so a sideways-stored phone photo gets the same
 * width and height here as in `prepareImage`.
 */
export async function readImageSize(
  file: Blob,
): Promise<ImagePrepareError | { width: number; height: number }> {
  const bitmap = await decode(file)
  if (bitmap instanceof Error) return bitmap
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}

/**
 * Decode `file` with the browser (EXIF orientation applied — jSquash's decoders ignore it),
 * crop/scale it for `preset` on a canvas, check the result against the slot's image rules, then
 * encode it as WebP with jSquash, the same codecs the server decodes with — so every browser
 * produces WebP, including those whose canvas cannot. A rule break comes back as a
 * `FileImageRuleError` before any request is made.
 */
export async function prepareImage(
  file: Blob,
  preset: ImagePreset,
  options: PrepareImageOptions = {},
): Promise<ImagePrepareError | FileImageRuleError | Blob> {
  const bitmap = await decode(file)
  if (bitmap instanceof Error) return bitmap

  const target = imageTarget(preset, bitmap.width, bitmap.height, options.crop)
  const image = render(bitmap, target)
  bitmap.close()
  if (image instanceof Error) return image

  const policy = options.policy ?? (preset === 'avatar' ? AVATAR_POLICY : null)
  if (policy !== null) {
    const broken = checkImageRules({ mime: 'image/webp', ...target }, policy)
    if (broken !== undefined) return broken
  }

  const webp = await encodeWebp(image, { quality: QUALITY })
  if (webp instanceof Error)
    return new ImagePrepareError({ reason: 'encoding failed', cause: webp })
  return new Blob([webp], { type: 'image/webp' })
}
