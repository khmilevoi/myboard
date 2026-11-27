import { initImageCodecs } from 'image-codec'
import { packageWasmLoader } from 'image-codec/node'

import { codecImageDecoder, type ImageDecoder } from '../files/image-check'

let ready: Promise<void> | null = null

/** The real jSquash decoder, its codecs compiled from node_modules on first use. */
export const testImageDecoder: ImageDecoder = {
  async decode(bytes, mime) {
    ready ??= initImageCodecs(packageWasmLoader).then((initialised) => {
      if (initialised instanceof Error) throw initialised
    })
    await ready
    return codecImageDecoder.decode(bytes, mime)
  },
}
