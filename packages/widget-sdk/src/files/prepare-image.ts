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

const AVATAR_SIDE = 256
const PICTURE_LONGEST_SIDE = 1600
const QUALITY = 0.86

/**
 * `avatar`: the centred square of the shorter side, scaled to 256 px. `picture`: the whole image
 * with its longest side at most 1600 px. Neither ever upscales.
 */
export function imageTarget(preset: ImagePreset, width: number, height: number): ImageTarget {
  if (preset === 'avatar') {
    const side = Math.min(width, height)
    const out = Math.min(AVATAR_SIDE, side)
    return {
      sx: Math.floor((width - side) / 2),
      sy: Math.floor((height - side) / 2),
      sw: side,
      sh: side,
      width: out,
      height: out,
    }
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

/**
 * Decode `file`, crop/scale it for `preset` and encode it as WebP — or as JPEG on a browser that
 * cannot encode WebP (Safari before 17 silently hands back PNG). JPEG has no alpha, so that
 * fallback is drawn over white.
 */
export async function prepareImage(
  file: Blob,
  preset: ImagePreset,
): Promise<ImagePrepareError | Blob> {
  if (typeof createImageBitmap === 'undefined') {
    return new ImagePrepareError({ reason: 'createImageBitmap is unavailable' })
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(
    (cause: unknown) =>
      new ImagePrepareError({ reason: 'the file is not a readable image', cause }),
  )
  if (bitmap instanceof Error) return bitmap

  const target = imageTarget(preset, bitmap.width, bitmap.height)
  const webp = await render(bitmap, target, 'image/webp', null)
  if (webp instanceof Error || webp.type === 'image/webp') {
    bitmap.close()
    return webp
  }
  const jpeg = await render(bitmap, target, 'image/jpeg', '#fff')
  bitmap.close()
  return jpeg
}
