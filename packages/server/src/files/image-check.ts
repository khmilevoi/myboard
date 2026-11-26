import type { FileImage, FilePolicy } from '@shared/files/contract'
import { checkImageRules } from '@shared/files/image-rules'
import { decodeImage, initImageCodecs, type WasmLoader } from 'image-codec'

import { FileImageRejectedError, FileImageUndecodableError, FileUnavailableError } from './errors'
import type { InspectedUpload } from './upload'

/**
 * The server's authority over `FilePolicy.image`: a slot with image rules only ever stores bytes
 * that fully decode — with the same jSquash codecs the browser encodes with — and whose decoded
 * pixels satisfy the rules. The header the sniffer read is never trusted on its own.
 */

/** A full decode: the true pixel size, or why the bytes are not a whole image. */
export type ImageDecoder = {
  decode(
    bytes: Uint8Array,
    mime: string,
  ): Promise<FileUnavailableError | FileImageUndecodableError | FileImage>
}

/** Ready once `startImageCodecs` has compiled the codecs; until then decodes answer 503. */
export type DeferredImageDecoder = ImageDecoder & { markReady(): void; isReady(): boolean }

/** Decodes through `image-codec`, whose codecs must already be initialised. */
export const codecImageDecoder: ImageDecoder = {
  async decode(bytes, mime) {
    const decoded = await decodeImage(bytes, mime)
    if (decoded instanceof Error) return new FileImageUndecodableError({ mime, cause: decoded })
    return { width: decoded.width, height: decoded.height }
  },
}

export function makeDeferredImageDecoder(): DeferredImageDecoder {
  let ready = false
  return {
    markReady() {
      ready = true
    },
    isReady: () => ready,
    decode: async (bytes, mime) =>
      ready
        ? codecImageDecoder.decode(bytes, mime)
        : new FileUnavailableError({ reason: 'image codecs are not ready' }),
  }
}

/**
 * Compiles the codecs in the background and marks `decoder` ready. A failure is logged and leaves
 * image-rule uploads at 503; everything else keeps working.
 */
export function startImageCodecs(options: {
  decoder: DeferredImageDecoder
  loadWasm: WasmLoader
}): void {
  const { decoder, loadWasm } = options
  void initImageCodecs(loadWasm).then((initialised) => {
    if (initialised instanceof Error) {
      console.error(`image codecs stay unavailable: ${initialised.message}`, initialised.cause)
      return
    }
    decoder.markReady()
  })
}

/**
 * The most pixels a slot without `maxSide` lets the decoder allocate. The header is read first,
 * so a small file declaring a huge canvas (a decompression bomb) never reaches the decoder.
 */
export const MAX_DECODE_PIXELS = 40_000_000

function rejected(mime: string, size: FileImage, reason: string) {
  return new FileImageRejectedError({ reason, size: `${size.width}x${size.height}`, mime })
}

/**
 * For a policy with `image` rules: the header size passes the rules (cheap, and the bomb guard),
 * the bytes fully decode (415 otherwise), and the decoded size passes the rules again (422).
 * Answers the true size; without `image` rules, the header size the sniffer read.
 */
export async function verifyImageUpload(options: {
  bytes: Uint8Array
  inspected: InspectedUpload
  policy: FilePolicy
  decoder: ImageDecoder
}): Promise<
  FileUnavailableError | FileImageUndecodableError | FileImageRejectedError | FileImage | null
> {
  const { bytes, inspected, policy, decoder } = options
  if (policy.image === undefined) return inspected.image
  const { mime } = inspected

  const header = inspected.image
  if (header === null) return new FileImageUndecodableError({ mime })
  const headerBreak = checkImageRules({ mime, ...header }, policy)
  if (headerBreak !== undefined) return rejected(mime, header, headerBreak.reason)
  if (header.width * header.height > MAX_DECODE_PIXELS) return rejected(mime, header, 'too_large')

  const decoded = await decoder.decode(bytes, mime)
  if (decoded instanceof Error) return decoded
  const pixelBreak = checkImageRules({ mime, ...decoded }, policy)
  if (pixelBreak !== undefined) return rejected(mime, decoded, pixelBreak.reason)
  return decoded
}
