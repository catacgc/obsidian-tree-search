// packages/core/src/__tests__/reindex-archive.test.ts
import { describe, it, expect } from "bun:test"
import { buildGraphFromScanner, reindexFileInGraph } from "../graph/builder.ts"
import { DEFAULT_SETTINGS } from "../graph/indexer.ts"
import type { NotesGraph } from "../graph/graph.ts"
import { isArchived } from "../search/archive.ts"
import type { VaultScanner, WalkResult } from "../graph/scanner.ts"

// A single-file scanner whose content can be swapped between reads, so tests
// can simulate an incremental `reindexFileInGraph` call after an edit —
// mirroring what `IndexedTree.refreshPage` does on every `vault.modify` event.
function makeScanner(getContent: () => string): VaultScanner {
  return {
    async walkVault(): Promise<WalkResult> {
      return { files: [{ path: "note.md", mtime: 0, type: "markdown" }], folders: [] }
    },
    async readFile() {
      return { content: getContent(), mtime: 0 }
    },
  }
}

function textNodeKeys(graph: NotesGraph): string[] {
  return graph.filterNodes((_, n) => n.nodeType === "text")
}

describe("reindexFileInGraph — incremental reindex parity with full rebuild", () => {
  it("reflects archiving a line without a full vault rebuild", async () => {
    let content = "# note\n- buy milk #groceries\n"
    const scanner = makeScanner(() => content)

    const graph = await buildGraphFromScanner(scanner, DEFAULT_SETTINGS)
    const [key] = textNodeKeys(graph)
    expect(isArchived(graph.getNodeAttributes(key))).toBe(false)

    content = "# note\n- buy milk #groceries #archive\n"
    await reindexFileInGraph("note.md", graph, scanner, DEFAULT_SETTINGS)

    expect(textNodeKeys(graph)).toEqual(["buy milk #groceries #archive"])
    expect(isArchived(graph.getNodeAttributes("buy milk #groceries #archive"))).toBe(true)
  })

  it("reflects unarchiving a line without a full vault rebuild", async () => {
    let content = "# note\n- buy milk #groceries #archive\n    - check price #todo\n"
    const scanner = makeScanner(() => content)

    const graph = await buildGraphFromScanner(scanner, DEFAULT_SETTINGS)
    expect(isArchived(graph.getNodeAttributes("check price #todo"))).toBe(true)

    content = "# note\n- buy milk #groceries\n    - check price #todo\n"
    await reindexFileInGraph("note.md", graph, scanner, DEFAULT_SETTINGS)

    expect(isArchived(graph.getNodeAttributes("buy milk #groceries"))).toBe(false)
    expect(isArchived(graph.getNodeAttributes("check price #todo"))).toBe(false)
  })

  it("reflects unarchiving a heading by removing the next-line marker", async () => {
    let content = "## Old\n- #archive\n### Sub\n- buy milk #groceries\n"
    const scanner = makeScanner(() => content)

    const graph = await buildGraphFromScanner(scanner, DEFAULT_SETTINGS)
    expect(isArchived(graph.getNodeAttributes("note#sub"))).toBe(true)

    content = "## Old\n-\n### Sub\n- buy milk #groceries\n"
    await reindexFileInGraph("note.md", graph, scanner, DEFAULT_SETTINGS)

    expect(isArchived(graph.getNodeAttributes("note#old"))).toBe(false)
    expect(isArchived(graph.getNodeAttributes("note#sub"))).toBe(false)
    expect(isArchived(graph.getNodeAttributes("buy milk #groceries"))).toBe(false)
  })

  it("replaces a heading archived by tagging its next line", async () => {
    let content = "## Old\n-\n- buy milk #groceries\n"
    const scanner = makeScanner(() => content)

    const graph = await buildGraphFromScanner(scanner, DEFAULT_SETTINGS)
    content = "## Old\n- #archive\n- buy milk #groceries\n"
    await reindexFileInGraph("note.md", graph, scanner, DEFAULT_SETTINGS)

    expect(graph.hasNode("note#old")).toBe(true)
    expect(isArchived(graph.getNodeAttributes("note#old"))).toBe(true)
  })

  it("removes a deleted line from the graph without a full vault rebuild", async () => {
    let content = "# note\n- buy milk #groceries\n"
    const scanner = makeScanner(() => content)

    const graph = await buildGraphFromScanner(scanner, DEFAULT_SETTINGS)
    expect(textNodeKeys(graph)).toHaveLength(1)

    content = "# note\n"
    await reindexFileInGraph("note.md", graph, scanner, DEFAULT_SETTINGS)

    expect(textNodeKeys(graph)).toHaveLength(0)
  })
})
