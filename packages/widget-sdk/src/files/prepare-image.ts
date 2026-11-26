import * as errore from 'errore'

/**
 * Browser-side image preparation before an upload: decode (honouring EXIF orientation), crop or
 * scale, re-encode as WebP. The server never processes images, so this is where a 12 MP photo
 * becomes a few dozen kilobytes. Image-only on purpose — file slots accept any type, and other
 * files are uploaded as they are.
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
}

const AVATAR_SIDE = 256
const PICTURE_LONGEST_SIDE = 1600
const QUALITY = 0.86

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
  fillStyle: string | CanvasGradient | CanvasPattern
  fillRect(x: number, y: number, w: number, h: number): void
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
}

type Surface = { context: Canvas2D | null; encode(type: string): Promise<Blob | null> }

function makeSurface(width: number, height: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    return {
      context: canvas.getContext('2d'),
      encode: (type) =>
        canvas.convertToBlob({ type, quality: QUALITY }).catch((cause: unknown) => {
          console.warn('[prepareImage] convertToBlob failed', cause)
          return null
        }),
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return {
    context: canvas.getContext('2d'),
    encode: (type) => new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY)),
  }
}

async function render(
  bitmap: ImageBitmap,
  target: ImageTarget,
  type: string,
  background: string | null,
): Promise<ImagePrepareError | Blob> {
  const surface = makeSurface(target.width, target.height)
  if (!surface.context) return new ImagePrepareError({ reason: 'no 2d canvas context' })
  if (background !== null) {
    surface.context.fillStyle = background
    surface.context.fillRect(0, 0, target.width, target.height)
  }
  const { sx, sy, sw, sh, width, height } = target
  surface.context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height)
  const blob = await surface.encode(type)
  if (blob === null) return new ImagePrepareError({ reason: 'encoding failed' })
  return blob
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
 * Decode `file`, crop/scale it for `preset` and encode it as WebP — or as JPEG on a browser that
 * cannot encode WebP (Safari before 17 silently hands back PNG). JPEG has no alpha, so that
 * fallback is drawn over white.
 */
export async function prepareImage(
  file: Blob,
  preset: ImagePreset,
  options: PrepareImageOptions = {},
): Promise<ImagePrepareError | Blob> {
  const bitmap = await decode(file)
  if (bitmap instanceof Error) return bitmap

  const target = imageTarget(preset, bitmap.width, bitmap.height, options.crop)
  const webp = await render(bitmap, target, 'image/webp', null)
  if (webp instanceof Error || webp.type === 'image/webp') {
    bitmap.close()
    return webp
  }
  const jpeg = await render(bitmap, target, 'image/jpeg', '#fff')
  bitmap.close()
  return jpeg
}
