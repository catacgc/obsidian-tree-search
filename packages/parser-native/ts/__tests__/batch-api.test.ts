import { describe, it, expect, beforeAll } from "bun:test"
import { resolve } from "path"
import { readdirSync, statSync } from "fs"
import { createTsParserProvider, type DvList, type DvPage, type FileInput } from "@mdtree/core"
import { loadNativeParser, NativeParserProvider, chunkedBatch, type NativeParserHandle } from "../index.ts"

const WASM_PATH = resolve(import.meta.dir, "../../pkg/parser_native_bg.wasm")
const FIXTURES_PATH = resolve(import.meta.dir, "../../../core/src/__tests__/integration/fixtures")

let handle: NativeParserHandle
let nativeProvider: NativeParserProvider
const tsProvider = createTsParserProvider()

beforeAll(async () => {
  const wasmBytes = await Bun.file(WASM_PATH).arrayBuffer()
  handle = await loadNativeParser(wasmBytes)
  nativeProvider = new NativeParserProvider(handle)
})

/**
 * Recursively find all .md files under a directory.
 */
function findMdFiles(dir: string): string[] {
  const results: string[] = []
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const full = resolve(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      results.push(...findMdFiles(full))
    } else if (entry.endsWith(".md")) {
      results.push(full)
    }
  }
  return results
}

/**
 * Strip precomputedTokens from all DvList items recursively,
 * and precomputedParentTokens from the page.
 * Used for comparing structural equality between native and TS parser output.
 */
function stripPrecomputed(page: DvPage): DvPage {
  const stripList = (item: DvList): DvList => {
    const { precomputedTokens, ...rest } = item
    return {
      ...rest,
      children: rest.children.map(stripList),
    }
  }
  const { precomputedParentTokens, ...rest } = page
  return {
    ...rest,
    file: {
      ...rest.file,
      lists: { values: rest.file.lists.values.map(stripList) },
    },
  }
}

/**
 * Check that all DvList items (recursively) have precomputedTokens defined.
 */
function assertAllHavePrecomputedTokens(items: DvList[], context: string) {
  for (const item of items) {
    expect(item.precomputedTokens).toBeDefined()
    expect(Array.isArray(item.precomputedTokens)).toBe(true)
    assertAllHavePrecomputedTokens(item.children, `${context} > child at line ${item.line}`)
  }
}

describe("Batch API Conformance: Native vs TypeScript", () => {
  describe("Basic batch conformance across all fixtures", () => {
    const mdFiles = findMdFiles(FIXTURES_PATH)

    it("should produce structurally identical output (excluding precomputed fields)", async () => {
      const files: FileInput[] = []
      for (const filePath of mdFiles) {
        const relativePath = filePath.replace(FIXTURES_PATH + "/", "")
        const content = await Bun.file(filePath).text()
        files.push({ path: relativePath, content, mtime: 1700000000000, archiveTag: "archive" })
      }

      const nativePages = nativeProvider.parseBatchChunk(files)
      const tsPages = tsProvider.parseBatchChunk(files)

      expect(nativePages.length).toBe(tsPages.length)

      for (let i = 0; i < nativePages.length; i++) {
        const nativeStripped = stripPrecomputed(nativePages[i])
        const tsPage = tsPages[i]
        expect(nativeStripped).toEqual(tsPage)
      }
    })
  })

  describe("Pre-computed tokens match parseTokens", () => {
    it("should produce tokens matching standalone parseTokens for every list item", async () => {
      const mdFiles2 = findMdFiles(FIXTURES_PATH)
      const files: FileInput[] = []
      for (const filePath of mdFiles2) {
        const relativePath = filePath.replace(FIXTURES_PATH + "/", "")
        const content = await Bun.file(filePath).text()
        files.push({ path: relativePath, content, mtime: 1700000000000, archiveTag: "archive" })
      }

      const nativePages = nativeProvider.parseBatchChunk(files)

      function checkTokens(items: DvList[]) {
        for (const item of items) {
          const expected = tsProvider.parseTokens(item.rawText)
          expect(item.precomputedTokens).toEqual(expected)
          checkTokens(item.children)
        }
      }

      for (const page of nativePages) {
        checkTokens(page.file.lists.values)
      }
    })
  })

  describe("Pre-computed parent tokens", () => {
    it("should produce correct parent tokens for multi-page/index.md", async () => {
      const filePath = resolve(FIXTURES_PATH, "multi-page/index.md")
      const content = await Bun.file(filePath).text()
      const files: FileInput[] = [
        { path: "multi-page/index.md", content, mtime: 1700000000000, archiveTag: "archive" },
      ]

      const [page] = nativeProvider.parseBatchChunk(files)
      expect(page.precomputedParentTokens).toBeDefined()
      expect(page.precomputedParentTokens!.has("[[Root]]")).toBe(true)

      const expectedTokens = tsProvider.parseTokens("[[Root]]")
      expect(page.precomputedParentTokens!.get("[[Root]]")).toEqual(expectedTokens)
    })
  })

  describe("Single file matches batch", () => {
    it("should produce identical results from parseVaultFile and parseBatchChunk", async () => {
      const filePath = resolve(FIXTURES_PATH, "multi-page/index.md")
      const content = await Bun.file(filePath).text()
      const path = "multi-page/index.md"
      const mtime = 1700000000000
      const archiveTag = "archive"

      const singleResult = nativeProvider.parseVaultFile(content, path, mtime, archiveTag)
      const [batchResult] = nativeProvider.parseBatchChunk([{ path, content, mtime, archiveTag }])

      expect(singleResult).toEqual(batchResult)
    })
  })

  describe("Standalone parseTokens conformance", () => {
    it("should match TS parseTokens for simple obsidian link", () => {
      const native = nativeProvider.parseTokens("[[Link]]")
      const ts = tsProvider.parseTokens("[[Link]]")
      expect(native).toEqual(ts)
    })

    it("should match TS parseTokens for complex string", () => {
      const input = "text [[Page#Header|Alias]] more http://example.com"
      const native = nativeProvider.parseTokens(input)
      const ts = tsProvider.parseTokens(input)
      expect(native).toEqual(ts)
    })
  })

  describe("Empty batch", () => {
    it("should return empty array for empty input", () => {
      const result = nativeProvider.parseBatchChunk([])
      expect(result).toEqual([])
    })
  })

  describe("All DvList items have precomputedTokens defined", () => {
    it("should have precomputedTokens on every list item including children", async () => {
      const mdFiles3 = findMdFiles(FIXTURES_PATH)
      const files: FileInput[] = []
      for (const filePath of mdFiles3) {
        const relativePath = filePath.replace(FIXTURES_PATH + "/", "")
        const content = await Bun.file(filePath).text()
        files.push({ path: relativePath, content, mtime: 1700000000000, archiveTag: "archive" })
      }

      const nativePages = nativeProvider.parseBatchChunk(files)
      for (const page of nativePages) {
        assertAllHavePrecomputedTokens(page.file.lists.values, page.file.path)
      }
    })
  })

  describe("chunkedBatch utility", () => {
    it("should process all files and return correct results with chunking", async () => {
      const mdFiles4 = findMdFiles(FIXTURES_PATH)
      const files: FileInput[] = []
      for (const filePath of mdFiles4) {
        const relativePath = filePath.replace(FIXTURES_PATH + "/", "")
        const content = await Bun.file(filePath).text()
        files.push({ path: relativePath, content, mtime: 1700000000000, archiveTag: "archive" })
      }

      // Use chunk size of 2 to force multiple chunks
      const chunked = await chunkedBatch(tsProvider, files, 2)
      const allAtOnce = tsProvider.parseBatchChunk(files)

      expect(chunked.length).toBe(allAtOnce.length)
      expect(chunked).toEqual(allAtOnce)
    })

    it("should not yield when all files fit in one chunk", async () => {
      const files: FileInput[] = [
        { path: "a.md", content: "- [[A]]", mtime: 1, archiveTag: "archive" },
        { path: "b.md", content: "- [[B]]", mtime: 1, archiveTag: "archive" },
      ]

      // chunkSize 50, only 2 files — single chunk, no yielding
      const result = await chunkedBatch(tsProvider, files, 50)
      expect(result.length).toBe(2)
    })
  })
})
