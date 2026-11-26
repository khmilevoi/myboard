import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import type { WasmLoader } from './index'
import { WASM_FILES, wasmFileName, type WasmCodec } from './wasm-files'

/**
 * Node-only loaders for `initImageCodecs`, kept out of the package root so a browser bundle never
 * pulls `node:fs` in.
 */

const packageRequire = createRequire(import.meta.url)

/** Where a codec's binary sits in this package's `node_modules` — for build tooling and tests. */
export function wasmSourcePath(codec: WasmCodec): string {
  return packageRequire.resolve(WASM_FILES[codec])
}

/** Compiles the binaries straight from `node_modules`; tests and tooling only. */
export const packageWasmLoader: WasmLoader = async (codec) =>
  WebAssembly.compile(await fs.readFile(wasmSourcePath(codec)))

/**
 * Compiles the binaries a server bundle shipped flat in `dir`, under `wasmFileName` — a bundle
 * cannot count on `node_modules` being next to it.
 */
export function directoryWasmLoader(dir: string): WasmLoader {
  return async (codec) =>
    WebAssembly.compile(await fs.readFile(path.join(dir, wasmFileName(codec))))
}
