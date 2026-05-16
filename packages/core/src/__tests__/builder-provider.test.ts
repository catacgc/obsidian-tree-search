import { describe, it, expect } from "bun:test"
import { buildGraphFromScanner, reindexFileInGraph } from "../graph/builder.ts"
import { DEFAULT_SETTINGS } from "../graph/indexer.ts"
import type { VaultScanner, WalkResult } from "../graph/scanner.ts"
import type { ParserProvider, FileInput } from "../parser/parser-provider.ts"
import { TsParserProvider } from "../parser/parser-provider.ts"
import type { DvPage, ParsedTextToken } from "../graph/types.ts"

function makeScanner(
  fileMap: Record<string, string>,
  folders: { path: string; name: string }[] = [],
): VaultScanner {
  const files = Object.keys(fileMap).map(path => {
    const ext = path.split(".").pop()
    const type = ext === "md" ? "markdown" as const
      : ext === "canvas" ? "canvas" as const
      : "attachment" as const
    return { path, mtime: 1700000000000, type }
  })

  return {
    async walkVault(): Promise<WalkResult> {
      return { files, folders }
    },
    async readFile(relPath: string) {
      return { content: fileMap[relPath] ?? "", mtime: 1700000000000 }
    },
  }
}

function makeTrackingProvider(): ParserProvider & {
  batchCalls: FileInput[][]
  parseVaultFileCalls: string[]
  parseTokensCalls: string[]
} {
  const ts = new TsParserProvider()
  const tracker = {
    batchCalls: [] as FileInput[][],
    parseVaultFileCalls: [] as string[],
    parseTokensCalls: [] as string[],

    parseBatchChunk(files: FileInput[]): DvPage[] {
      tracker.batchCalls.push(files)
      return ts.parseBatchChunk(files)
    },

    parseTokens(text: string): ParsedTextToken[] {
      tracker.parseTokensCalls.push(text)
      return ts.parseTokens(text)
    },

    parseVaultFile(content: string, filePath: string, mtime: number, archiveTag: string): DvPage {
      tracker.parseVaultFileCalls.push(filePath)
      return ts.parseVaultFile(content, filePath, mtime, archiveTag)
    },
  }
  return tracker
}

describe("buildGraphFromScanner with ParserProvider", () => {
  it("batch path is used when provider is given", async () => {
    const scanner = makeScanner({
      "note1.md": "- [[A]] text",
      "note2.md": "- [[B]] text",
      "note3.md": "- [[C]] text",
    })
    const provider = makeTrackingProvider()

    await buildGraphFromScanner(scanner, DEFAULT_SETTINGS, provider)

    expect(provider.batchCalls.length).toBeGreaterThan(0)
    expect(provider.parseVaultFileCalls).toHaveLength(0) // no individual parseVaultFile on happy path
  })

  it("batch path produces same graph as fallback path", async () => {
    const scanner = makeScanner({
      "note1.md": "---\nparent: \"[[Root]]\"\n---\n\n# Header\n\n- [[A]] item\n  - child [[B]]",
      "note2.md": "- [[C]] text\n- plain link text http://example.com",
    })

    const graphWithoutProvider = await buildGraphFromScanner(scanner, DEFAULT_SETTINGS)
    const graphWithProvider = await buildGraphFromScanner(scanner, DEFAULT_SETTINGS, new TsParserProvider())

    // Same number of nodes
    expect(graphWithProvider.order).toBe(graphWithoutProvider.order)

    // Same node keys
    const nodesWithout = graphWithoutProvider.filterNodes(() => true).sort()
    const nodesWith = graphWithProvider.filterNodes(() => true).sort()
    expect(nodesWith).toEqual(nodesWithout)
  })

  it("chunked yielding occurs with correct number of batches", async () => {
    // 12 files with chunkSize 5 => 3 batch calls (5, 5, 2)
    const fileMap: Record<string, string> = {}
    for (let i = 0; i < 12; i++) {
      fileMap[`note-${i}.md`] = `- [[Link${i}]] text`
    }
    const scanner = makeScanner(fileMap)
    const provider = makeTrackingProvider()

    let macrotasksFired = 0
    const interval = setInterval(() => { macrotasksFired++ }, 0)
    try {
      await buildGraphFromScanner(scanner, DEFAULT_SETTINGS, provider, 5)
      expect(provider.batchCalls).toHaveLength(3)
      expect(provider.batchCalls[0]).toHaveLength(5)
      expect(provider.batchCalls[1]).toHaveLength(5)
      expect(provider.batchCalls[2]).toHaveLength(2)
      expect(macrotasksFired).toBeGreaterThan(0)
    } finally {
      clearInterval(interval)
    }
  })

  it("canvas files use provider.parseTokens", async () => {
    const canvasData = JSON.stringify({
      nodes: [
        {
          id: "node1",
          type: "text",
          text: "- [[CanvasLink]] content",
          x: 0, y: 0, width: 100, height: 100,
        },
      ],
      edges: [],
    })
    const scanner = makeScanner({ "test.canvas": canvasData })
    const provider = makeTrackingProvider()

    await buildGraphFromScanner(scanner, DEFAULT_SETTINGS, provider)

    // provider.parseTokens should have been called for canvas text lines
    expect(provider.parseTokensCalls.length).toBeGreaterThan(0)
    expect(provider.parseTokensCalls.some(t => t.includes("CanvasLink"))).toBe(true)
  })

  it("reindexFileInGraph with provider uses parseVaultFile for .md", async () => {
    const scanner = makeScanner({
      "note.md": "- [[A]] text",
    })
    const provider = makeTrackingProvider()

    // Build initial graph without provider (uses fallback)
    const graph = await buildGraphFromScanner(scanner, DEFAULT_SETTINGS)
    expect(graph.hasNode("[[a]]")).toBe(true)

    // Reindex with provider
    await reindexFileInGraph("note.md", graph, scanner, DEFAULT_SETTINGS, provider)

    expect(provider.parseVaultFileCalls).toContain("note.md")
    expect(graph.hasNode("[[a]]")).toBe(true)
  })

  it("reindexFileInGraph without provider uses fallback", async () => {
    const scanner = makeScanner({
      "note.md": "- [[A]] text",
    })

    const graph = await buildGraphFromScanner(scanner, DEFAULT_SETTINGS)
    expect(graph.hasNode("[[a]]")).toBe(true)

    // Reindex without provider — should still work
    await reindexFileInGraph("note.md", graph, scanner, DEFAULT_SETTINGS)
    expect(graph.hasNode("[[a]]")).toBe(true)
  })

  it("batch chunk failure triggers per-file retry", async () => {
    const scanner = makeScanner({
      "note1.md": "- [[A]] text",
      "note2.md": "- [[B]] text",
      "note3.md": "- [[C]] text",
    })

    const ts = new TsParserProvider()
    let batchCallCount = 0
    const provider: ParserProvider = {
      parseBatchChunk(_files: FileInput[]): DvPage[] {
        batchCallCount++
        throw new Error("Simulated WASM panic")
      },
      parseTokens(text: string): ParsedTextToken[] {
        return ts.parseTokens(text)
      },
      parseVaultFile(content: string, filePath: string, mtime: number, archiveTag: string): DvPage {
        return ts.parseVaultFile(content, filePath, mtime, archiveTag)
      },
    }

    const graph = await buildGraphFromScanner(scanner, DEFAULT_SETTINGS, provider, 50)

    // parseBatchChunk was attempted
    expect(batchCallCount).toBe(1)
    // Per-file retry succeeded — all nodes present
    expect(graph.hasNode("[[a]]")).toBe(true)
    expect(graph.hasNode("[[b]]")).toBe(true)
    expect(graph.hasNode("[[c]]")).toBe(true)
  })

  it("partial failure within a retried chunk: only failing file is skipped", async () => {
    const scanner = makeScanner({
      "note1.md": "- [[A]] text",
      "bad.md": "- [[B]] text",
      "note3.md": "- [[C]] text",
    })

    const ts = new TsParserProvider()
    const provider: ParserProvider = {
      parseBatchChunk(_files: FileInput[]): DvPage[] {
        throw new Error("Simulated WASM panic")
      },
      parseTokens(text: string): ParsedTextToken[] {
        return ts.parseTokens(text)
      },
      parseVaultFile(content: string, filePath: string, mtime: number, archiveTag: string): DvPage {
        if (filePath === "bad.md") {
          throw new Error("Simulated parse failure for bad.md")
        }
        return ts.parseVaultFile(content, filePath, mtime, archiveTag)
      },
    }

    const graph = await buildGraphFromScanner(scanner, DEFAULT_SETTINGS, provider, 50)

    // Successful files are indexed
    expect(graph.hasNode("[[a]]")).toBe(true)
    expect(graph.hasNode("[[c]]")).toBe(true)
    // Failed file's link is not indexed
    expect(graph.hasNode("[[b]]")).toBe(false)
  })

  it("default chunk size is 50", async () => {
    // Create 60 files to verify default creates 2 chunks (50 + 10)
    const fileMap: Record<string, string> = {}
    for (let i = 0; i < 60; i++) {
      fileMap[`note-${i}.md`] = `- [[Link${i}]] text`
    }
    const scanner = makeScanner(fileMap)
    const provider = makeTrackingProvider()

    await buildGraphFromScanner(scanner, DEFAULT_SETTINGS, provider)

    // Default chunkSize = 50: 2 batches (50, 10)
    expect(provider.batchCalls).toHaveLength(2)
    expect(provider.batchCalls[0]).toHaveLength(50)
    expect(provider.batchCalls[1]).toHaveLength(10)
  })
})
