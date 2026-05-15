import { describe, it, expect, beforeAll } from "bun:test"
import { resolve } from "path"
import { parseFrontmatter } from "@mdtree/core"
import { adaptFrontmatter } from "../adapter.ts"
import type { NativeParserHandle } from "../index.ts"
import { loadNativeParser } from "../index.ts"

// This test requires `wasm-pack build --target web --out-dir pkg` to have been run first.
const WASM_PATH = resolve(import.meta.dir, "../../pkg/parser_native_bg.wasm")
const FIXTURES_PATH = resolve(import.meta.dir, "../../../core/src/__tests__/integration/fixtures")

let handle: NativeParserHandle

beforeAll(async () => {
  const wasmBytes = await Bun.file(WASM_PATH).arrayBuffer()
  handle = await loadNativeParser(wasmBytes)
})

function parseWithRust(content: string) {
  const json = handle.parse_frontmatter(content)
  return adaptFrontmatter(json)
}

describe("Frontmatter Conformance: Rust vs TypeScript", () => {
  describe("Fixture files", () => {
    it("aliases/meeting notes.md — aliases array", async () => {
      const content = await Bun.file(resolve(FIXTURES_PATH, "aliases/meeting notes.md")).text()
      const tsResult = parseFrontmatter(content)
      const rustResult = parseWithRust(content)
      expect(rustResult.frontmatter).toEqual(tsResult.frontmatter)
      expect(rustResult.bodyStart).toBe(tsResult.bodyStart)
    })

    it("multi-page/index.md — parent with obsidian link", async () => {
      const content = await Bun.file(resolve(FIXTURES_PATH, "multi-page/index.md")).text()
      const tsResult = parseFrontmatter(content)
      const rustResult = parseWithRust(content)
      expect(rustResult.frontmatter).toEqual(tsResult.frontmatter)
      expect(rustResult.bodyStart).toBe(tsResult.bodyStart)
    })
  })

  describe("Synthetic inputs", () => {
    it("tags as array", () => {
      const content = "---\ntags:\n  - work\n  - personal\n---\nbody"
      const tsResult = parseFrontmatter(content)
      const rustResult = parseWithRust(content)
      expect(rustResult.frontmatter).toEqual(tsResult.frontmatter)
      expect(rustResult.bodyStart).toBe(tsResult.bodyStart)
    })

    it("tags as string", () => {
      const content = "---\ntags: work\n---\nbody"
      const tsResult = parseFrontmatter(content)
      const rustResult = parseWithRust(content)
      expect(rustResult.frontmatter).toEqual(tsResult.frontmatter)
      expect(rustResult.bodyStart).toBe(tsResult.bodyStart)
    })

    it("no frontmatter", () => {
      const content = "# Just a header"
      const tsResult = parseFrontmatter(content)
      const rustResult = parseWithRust(content)
      expect(rustResult.frontmatter).toEqual(tsResult.frontmatter)
      expect(rustResult.bodyStart).toBe(tsResult.bodyStart)
    })

    it("empty frontmatter block (with newline)", () => {
      const content = "---\n\n---\nbody"
      const tsResult = parseFrontmatter(content)
      const rustResult = parseWithRust(content)
      expect(rustResult.frontmatter).toEqual(tsResult.frontmatter)
      expect(rustResult.bodyStart).toBe(tsResult.bodyStart)
    })

    it("nested objects", () => {
      const content = "---\nmetadata:\n  author: Jane\n  version: 2\n---\n"
      const tsResult = parseFrontmatter(content)
      const rustResult = parseWithRust(content)
      expect(rustResult.frontmatter).toEqual(tsResult.frontmatter)
      expect(rustResult.bodyStart).toBe(tsResult.bodyStart)
    })

    it("CRLF line endings", () => {
      const content = "---\r\naliases:\r\n  - Meeting1\r\n  - Meeting2\r\n---\r\nbody"
      const tsResult = parseFrontmatter(content)
      const rustResult = parseWithRust(content)
      expect(rustResult.frontmatter).toEqual(tsResult.frontmatter)
      expect(rustResult.bodyStart).toBe(tsResult.bodyStart)
    })

    it("malformed YAML", () => {
      const content = "---\n{invalid\n---\nbody"
      const tsResult = parseFrontmatter(content)
      const rustResult = parseWithRust(content)
      expect(rustResult.frontmatter).toEqual(tsResult.frontmatter)
      expect(rustResult.bodyStart).toBe(tsResult.bodyStart)
    })

    it("boolean and number values", () => {
      const content = "---\ndraft: true\ncount: 5\n---\n"
      const tsResult = parseFrontmatter(content)
      const rustResult = parseWithRust(content)
      expect(rustResult.frontmatter).toEqual(tsResult.frontmatter)
      expect(rustResult.bodyStart).toBe(tsResult.bodyStart)
    })
  })
})
