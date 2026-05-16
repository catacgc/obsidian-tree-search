// This module is resolved by the esbuild wasmInlinePlugin at build time.
// The plugin intercepts .wasm imports and replaces them with a base64 string.
// At type-check time, the declare below provides the correct type signature.
declare const wasmBase64: string
// @ts-ignore — esbuild resolves this .wasm import to a base64 string module via wasmInlinePlugin
import wasmBase64Imported from "../../packages/parser-native/pkg/parser_native_bg.wasm"

function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

export const wasmBytes: Uint8Array = decodeBase64(wasmBase64Imported as unknown as string)
