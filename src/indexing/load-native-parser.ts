import type { ParserProvider } from "@mdtree/core"

/**
 * Attempt to load the native WASM parser and return a ParserProvider.
 * Returns null if WASM loading fails for any reason (unsupported environment,
 * corrupted binary, memory limit, etc.).
 *
 * Uses dynamic imports so that any failure in loading the WASM bytes module
 * or the parser-native package is caught by the try/catch wrapper.
 * With esbuild bundle: true, these dynamic imports are inlined into the
 * main chunk — no filesystem access is needed at runtime (important for mobile).
 */
export async function loadNativeParserProvider(): Promise<ParserProvider | null> {
  try {
    const { wasmBytes } = await import("../wasm/parser-native-wasm")
    const { loadNativeParser, createNativeParserProvider } = await import("@mdtree/parser-native")
    const handle = await loadNativeParser(wasmBytes as BufferSource)
    return createNativeParserProvider(handle)
  } catch (error) {
    console.warn("[mdtree] Failed to load native WASM parser, falling back to TypeScript parser:", error)
    return null
  }
}
