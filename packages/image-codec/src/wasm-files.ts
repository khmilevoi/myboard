/**
 * Every WebAssembly binary the codecs can load, by codec. The value is the file's path inside
 * `node_modules`; a server ships each one flat, under its basename, next to its bundle.
 *
 * `webp-encode` and `webp-encode-simd` are alternatives: `@jsquash/webp/encode` picks its glue
 * code by `wasm-feature-detect`'s `simd()`, so the binary handed to it must be the matching one.
 */
export const WASM_FILES = {
  'webp-decode': '@jsquash/webp/codec/dec/webp_dec.wasm',
  'webp-encode': '@jsquash/webp/codec/enc/webp_enc.wasm',
  'webp-encode-simd': '@jsquash/webp/codec/enc/webp_enc_simd.wasm',
  'jpeg-decode': '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm',
  'png-decode': '@jsquash/png/codec/pkg/squoosh_png_bg.wasm',
} as const

export type WasmCodec = keyof typeof WASM_FILES

/** The decoders a server needs; the encoders stay in the browser. */
export const DECODER_CODECS = ['webp-decode', 'jpeg-decode', 'png-decode'] as const

/** The basename a codec's binary is shipped under. */
export function wasmFileName(codec: WasmCodec): string {
  const file = WASM_FILES[codec]
  return file.slice(file.lastIndexOf('/') + 1)
}
