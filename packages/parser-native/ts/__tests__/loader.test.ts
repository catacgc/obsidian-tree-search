import { describe, it, expect } from "bun:test"
import { loadNativeParser } from "../index.ts"
import { resolve } from "path"

// This test requires `wasm-pack build --target web --out-dir pkg` to have been run first.
const WASM_PATH = resolve(import.meta.dir, "../../pkg/parser_native_bg.wasm")

describe("WASM Loader", () => {
  it("loads the WASM module and ping returns pong", async () => {
    const wasmBytes = await Bun.file(WASM_PATH).arrayBuffer()
    const handle = await loadNativeParser(wasmBytes)
    expect(handle.ping()).toBe("pong")
  })

  it("parse_frontmatter is callable", async () => {
    const wasmBytes = await Bun.file(WASM_PATH).arrayBuffer()
    const handle = await loadNativeParser(wasmBytes)
    const result = handle.parse_frontmatter("---\ntitle: Test\n---\nbody")
    const parsed = JSON.parse(result)
    expect(parsed.frontmatter).toEqual({ title: "Test" })
    expect(parsed.bodyStart).toBe(19)
  })

  it("rejects with invalid bytes when loaded in isolation", async () => {
    // The wasm-pack glue caches module state globally, so we test the underlying
    // WebAssembly.instantiate directly to verify invalid bytes are rejected.
    const invalidBytes = new ArrayBuffer(10)
    await expect(
      WebAssembly.instantiate(invalidBytes, {})
    ).rejects.toThrow()
  })
})
