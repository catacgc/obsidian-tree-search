export { loadWasm, type WasmExports } from "./loader.ts"
export { adaptFrontmatter, adaptScanResult } from "./adapter.ts"

export type NativeParserHandle = {
  ping: () => string
  parse_frontmatter: (content: string) => string
  scan_markdown: (content: string, file_path: string, frontmatter_body_start: number, archive_tag: string) => string
}

/**
 * Load the native parser WASM module and return a handle to its exports.
 * This is the primary entry point for consumers.
 */
export async function loadNativeParser(wasmBytes: BufferSource): Promise<NativeParserHandle> {
  const { loadWasm } = await import("./loader.ts")
  const exports = await loadWasm(wasmBytes)
  return exports
}
