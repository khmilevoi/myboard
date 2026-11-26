import * as errore from 'errore'

import type { DecodedImage } from './encode'
import type { WasmCodec } from './wasm-files'

export { ImageEncodeError, encodeWebp, type DecodedImage } from './encode'
export { DECODER_CODECS, WASM_FILES, wasmFileName, type WasmCodec } from './wasm-files'

/**
 * One image layer for the browser and the server, on jSquash (Squoosh's codecs compiled to
 * WebAssembly), so both sides decode and encode with the same code. Every jSquash module is
 * imported lazily: a page that never processes a photo never fetches a codec.
 *
 * A browser that only encodes imports `image-codec/encode`, so its bundle never even emits the
 * decoders' binaries.
 *
 * Browser: nothing to set up — jSquash's own loaders fetch the `.wasm` files the bundler emitted,
 * on first use. Node: call `initImageCodecs` once with a loader that compiles the shipped files
 * (`image-codec/node`), because jSquash's loaders cannot read a file from disk there.
 */

export const DECODABLE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type DecodableMime = (typeof DECODABLE_MIME_TYPES)[number]

export function isDecodableMime(mime: string): mime is DecodableMime {
  return (DECODABLE_MIME_TYPES as readonly string[]).includes(mime)
}

export class ImageCodecInitError extends errore.createTaggedError({
  name: 'ImageCodecInitError',
  message: 'Could not initialise the $codec codec',
}) {}

export class ImageDecodeError extends errore.createTaggedError({
  name: 'ImageDecodeError',
  message: 'Could not decode the bytes as $mime',
}) {}

/** Compiles one codec's binary: the seam between this package and wherever the files live. */
export type WasmLoader = (codec: WasmCodec) => Promise<WebAssembly.Module>

// jSquash's typings only declare `init(options)`; at runtime every `init` also takes the compiled
// module as its first argument, which is what a Node host needs.
type ModuleInit = (module: WebAssembly.Module) => Promise<unknown>

/**
 * The PNG decoder builds its result with `new ImageData(...)`, which Node lacks (the WebP and JPEG
 * glue install the same stand-in for themselves). A browser always has the real one.
 */
function ensureImageDataGlobal(): void {
  if ('ImageData' in globalThis) return
  class NodeImageData {
    constructor(
      readonly data: Uint8ClampedArray,
      readonly width: number,
      readonly height: number,
    ) {}
  }
  Object.assign(globalThis, { ImageData: NodeImageData })
}

async function initOne(
  codec: WasmCodec,
  loadWasm: WasmLoader,
  loadEntry: () => Promise<{ init: unknown }>,
): Promise<ImageCodecInitError | void> {
  const loaded = await Promise.all([loadEntry(), loadWasm(codec)]).catch(
    (cause) => new ImageCodecInitError({ codec, cause }),
  )
  if (loaded instanceof Error) return loaded
  const [entry, module] = loaded
  return (entry.init as ModuleInit)(module).then(
    () => undefined,
    (cause) => new ImageCodecInitError({ codec, cause }),
  )
}

/**
 * Hands every decoder — and, with `webpEncoder`, the WebP encoder — its compiled module. Call it
 * once at startup and wait for it before the first decode. Only Node needs it.
 */
export async function initImageCodecs(
  loadWasm: WasmLoader,
  options: { webpEncoder?: boolean } = {},
): Promise<ImageCodecInitError | void> {
  ensureImageDataGlobal()
  const encoder: Promise<ImageCodecInitError | void>[] = []
  if (options.webpEncoder === true) {
    const { simd } = await import('wasm-feature-detect')
    const codec = (await simd()) ? 'webp-encode-simd' : 'webp-encode'
    encoder.push(initOne(codec, loadWasm, () => import('@jsquash/webp/encode.js')))
  }
  const results = await Promise.all([
    initOne('webp-decode', loadWasm, () => import('@jsquash/webp/decode.js')),
    initOne('jpeg-decode', loadWasm, () => import('@jsquash/jpeg/decode.js')),
    initOne('png-decode', loadWasm, () => import('@jsquash/png/decode.js')),
    ...encoder,
  ])
  return results.find((result) => result instanceof Error)
}

type JsquashImage = { width: number; height: number; data: Uint8ClampedArray }

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const whole =
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  return whole ? (bytes.buffer as ArrayBuffer) : bytes.slice().buffer
}

async function runDecoder(mime: DecodableMime, buffer: ArrayBuffer): Promise<JsquashImage> {
  if (mime === 'image/webp') return (await import('@jsquash/webp/decode.js')).default(buffer)
  if (mime === 'image/jpeg') return (await import('@jsquash/jpeg/decode.js')).default(buffer)
  ensureImageDataGlobal()
  return (await import('@jsquash/png/decode.js')).decode(buffer)
}

/**
 * Fully decodes `bytes` as `mime` into RGBA pixels. Success proves the bytes are a whole image of
 * that type and gives its true size; a header that merely looks right fails here.
 */
export async function decodeImage(
  bytes: Uint8Array,
  mime: string,
): Promise<ImageDecodeError | DecodedImage> {
  if (!isDecodableMime(mime)) return new ImageDecodeError({ mime })
  const decoded = await runDecoder(mime, toArrayBuffer(bytes)).catch(
    (cause) => new ImageDecodeError({ mime, cause }),
  )
  if (decoded instanceof Error) return decoded
  const { width, height, data } = decoded
  if (!(width > 0 && height > 0 && data.length === width * height * 4)) {
    return new ImageDecodeError({ mime })
  }
  const image: DecodedImage = { width, height, data }
  return image
}
