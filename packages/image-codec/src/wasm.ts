/**
 * The one `WebAssembly` call Node hosts make, typed locally: a server compiles this package without
 * the DOM lib, where `WebAssembly` exists only as a namespace of types.
 */
type WasmCompiler = { compile(bytes: Uint8Array): Promise<WebAssembly.Module> }

export function compileWasm(bytes: Uint8Array): Promise<WebAssembly.Module> {
  return (globalThis as unknown as { WebAssembly: WasmCompiler }).WebAssembly.compile(bytes)
}
