import * as errore from 'errore'

/**
 * The WebP encoder alone, for a browser bundle: importing only this module keeps the decoders'
 * `.wasm` out of the build. The package root re-exports it.
 */

/** RGBA pixels, 4 bytes per pixel, row-major — the shape of a DOM `ImageData`. */
export type DecodedImage = { width: number; height: number; data: Uint8ClampedArray }

export class ImageEncodeError extends errore.createTaggedError({
  name: 'ImageEncodeError',
  message: 'Could not encode a $size image as WebP',
}) {}

/** Encodes RGBA pixels as lossy WebP; `quality` is 0–100. */
export async function encodeWebp(
  image: DecodedImage,
  options: { quality: number },
): Promise<ImageEncodeError | Uint8Array<ArrayBuffer>> {
  const size = `${image.width}x${image.height}`
  const encode = await import('@jsquash/webp/encode.js')
    .then((entry) => entry.default)
    .catch((cause) => new ImageEncodeError({ size, cause }))
  if (encode instanceof Error) return encode
  // jSquash reads only `data`, `width` and `height` off its `ImageData` argument.
  const input = image as unknown as Parameters<typeof encode>[0]
  const encoded = await encode(input, { quality: options.quality }).catch(
    (cause) => new ImageEncodeError({ size, cause }),
  )
  if (encoded instanceof Error) return encoded
  return new Uint8Array(encoded)
}
