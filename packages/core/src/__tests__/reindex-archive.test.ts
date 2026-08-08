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

    content = "# note\n- buy milk #groceries (meta-mdtree:: archive)\n"
    await reindexFileInGraph("note.md", graph, scanner, DEFAULT_SETTINGS)

    // Same searchKey (the annotation is stripped from it), so this must be a
    // real update to the existing node, not a silent no-op.
    expect(textNodeKeys(graph)).toEqual([key])
    expect(isArchived(graph.getNodeAttributes(key))).toBe(true)
  })

  it("reflects unarchiving a line without a full vault rebuild", async () => {
    let content = "# note\n- buy milk #groceries (meta-mdtree:: archive)\n"
    const scanner = makeScanner(() => content)

    const graph = await buildGraphFromScanner(scanner, DEFAULT_SETTINGS)
    const [key] = textNodeKeys(graph)
    expect(isArchived(graph.getNodeAttributes(key))).toBe(true)

    content = "# note\n- buy milk #groceries\n"
    await reindexFileInGraph("note.md", graph, scanner, DEFAULT_SETTINGS)

    expect(isArchived(graph.getNodeAttributes(key))).toBe(false)
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
