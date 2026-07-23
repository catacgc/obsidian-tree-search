import { describe, it, expect } from "bun:test"
import { loadFixture, search, searchKeys } from "./helpers.ts"
import { partitionArchived } from "../../search/archive.ts"
import { pruneResultTree, type ResultNode } from "../../search/search.ts"
import { matchQuery, parseQuery, type QueryExpr } from "../../search/query.ts"
import { DEFAULT_SETTINGS } from "../../graph/indexer.ts"
import type { ParsedNode } from "../../graph/types.ts"

function collectKeysFromResults(nodes: ResultNode[]): string[] {
  const keys: string[] = []
  function walk(nodes: ResultNode[]): void {
    for (const n of nodes) {
      keys.push(n.node.searchKey)
      walk(n.children)
    }
  }
  walk(nodes)
  return keys
}

// ── aliases ───────────────────────────────────────────────────────────────────

describe("aliases", () => {
  const g = loadFixture("aliases")

  it("page node stores aliases from frontmatter", () => {
    const node = g.getNodeAttributes("[[meeting notes]]") as { aliases: string[] }
    expect(node.aliases).toContain("Meeting1")
    expect(node.aliases).toContain("Meeting2")
  })

  it("searchable by alias Meeting1", () => {
    const keys = searchKeys(g, "meeting1")
    expect(keys).toContain("meeting notes|meeting1 meeting2")
  })

  it("searchable by alias Meeting2", () => {
    const keys = searchKeys(g, "meeting2")
    expect(keys).toContain("meeting notes|meeting1 meeting2")
  })
})

// ── basic-search ──────────────────────────────────────────────────────────────

describe("basic-search", () => {
  const g = loadFixture("basic-search")

  it("finds the page by name", () => {
    const keys = searchKeys(g, "meeting")
    expect(keys).toContain("meeting notes|")
  })

  it("finds a link reference by name", () => {
    const keys = searchKeys(g, "action item")
    expect(keys).toContain("action item")
  })

  it("finds a text node by partial content", () => {
    const keys = searchKeys(g, "follow up")
    expect(keys.some(k => k.includes("follow up"))).toBe(true)
  })

  it("returns empty for no match", () => {
    expect(search(g, "zzz_nonexistent")).toHaveLength(0)
  })
})

// ── deep-nesting ──────────────────────────────────────────────────────────────

describe("deep-nesting", () => {
  const g = loadFixture("deep-nesting")

  it("finds the top-level page", () => {
    const keys = searchKeys(g, "architecture")
    expect(keys).toContain("architecture|")
  })

  it("page.backend finds results under the Backend header", () => {
    const keys = searchKeys(g, "architecture.backend")
    expect(keys.some(k => k.includes("schema"))).toBe(true)
    expect(keys.some(k => k.includes("migrations"))).toBe(true)
    expect(keys.some(k => k.includes("endpoints"))).toBe(true)
  })

  it("page.backend.database finds results under Database subheader", () => {
    const keys = searchKeys(g, "architecture.backend.database")
    expect(keys.some(k => k.includes("schema"))).toBe(true)
    expect(keys.some(k => k.includes("migrations"))).toBe(true)
    expect(keys.some(k => k.includes("endpoints"))).toBe(false)
  })

  it("page.backend.database.schema finds Schema link under Database", () => {
    const keys = searchKeys(g, "architecture.backend.database.schema")
    expect(keys.some(k => k.includes("schema"))).toBe(true)
  })

  it("page.api does not include Database-scoped items", () => {
    const keys = searchKeys(g, "architecture.api.endpoints")
    // Should find Endpoints but NOT Schema or Migrations
    expect(keys.some(k => k.includes("endpoints"))).toBe(true)
    expect(keys.some(k => k.includes("schema"))).toBe(false)
  })
})

// ── multi-page ────────────────────────────────────────────────────────────────

describe("multi-page", () => {
  const g = loadFixture("multi-page")

  it("both pages are indexed", () => {
    expect(searchKeys(g, "index")).toContain("index|")
    expect(searchKeys(g, "child note")).toContain("child note|")
  })

  it("frontmatter parent creates edge: root → index", () => {
    // Searching for 'root' should surface the virtual Root page
    const keys = searchKeys(g, "root")
    expect(keys.some(k => k.includes("root"))).toBe(true)
  })

  it("cross-page link is findable", () => {
    const keys = searchKeys(g, "external resource")
    expect(keys.some(k => k.includes("external resource"))).toBe(true)
  })
})

// ── negation ──────────────────────────────────────────────────────────────────

describe("negation", () => {
  const g = loadFixture("negation")

  it("finds all task links without filter", () => {
    const keys = searchKeys(g, "work items")
    expect(keys.length).toBeGreaterThan(0)
  })

  it("negation excludes matching items", () => {
    // work items . -low  → should exclude Task Beta (low priority) but keep Alpha and Gamma
    const keys = searchKeys(g, "work items.-low")
    expect(keys.some(k => k.includes("beta"))).toBe(false)
    expect(keys.some(k => k.includes("alpha"))).toBe(true)
  })
})

// ── page-header-link (bug scenario) ──────────────────────────────────────────

describe("page-header-link", () => {
  const g = loadFixture("page-header-link")

  it("page query finds the projects page", () => {
    const keys = searchKeys(g, "projects")
    expect(keys.some(k => k.includes("projects"))).toBe(true)
  })

  it("page.link finds all links regardless of header", () => {
    const keys = searchKeys(g, "projects.alpha")
    expect(keys.some(k => k.includes("alpha"))).toBe(true)
  })

  it("page.active finds results under Active header", () => {
    const keys = searchKeys(g, "projects.active")
    expect(keys.some(k => k.includes("alpha"))).toBe(true)
    expect(keys.some(k => k.includes("beta"))).toBe(true)
    expect(keys.some(k => k.includes("old"))).toBe(false)
  })

  // This is the bug: page.active.alpha should find Alpha (under Active header)
  // but currently returns empty
  it("page.active.alpha finds Alpha link under Active header", () => {
    const keys = searchKeys(g, "projects.active.alpha")
    expect(keys.some(k => k.includes("alpha"))).toBe(true)
  })

  // Symmetrical: page.archive.alpha should NOT find Alpha (it's under Active)
  it("page.archive.alpha does NOT find Alpha (wrong header)", () => {
    const keys = searchKeys(g, "projects.archive.alpha")
    expect(keys.some(k => k.includes("alpha"))).toBe(false)
  })

  // page.archive.old should find Old Project
  it("page.archive.old finds Old Project under Archive header", () => {
    const keys = searchKeys(g, "projects.archive.old")
    expect(keys.some(k => k.includes("old"))).toBe(true)
  })
})

// ── archive ───────────────────────────────────────────────────────────────────

describe("archive", () => {
  const g = loadFixture("archive")

  it("search returns archived nodes (search is unaware of archive)", () => {
    const keys = searchKeys(g, "projects")
    expect(keys.some(k => k.includes("beta"))).toBe(true)
    expect(keys.some(k => k.includes("subtask"))).toBe(true)
  })

  it("partitionArchived removes the archived subtree", () => {
    const results = search(g, "projects")
    const { visible, archivedCount } = partitionArchived(results)

    // "[[Beta]] done" (archived) + "[[SubTask]] completed" (child) = 2 archived
    expect(archivedCount).toBe(2)

    // Flatten visible keys to check Beta is gone
    const visibleKeys = collectKeysFromResults(visible)
    expect(visibleKeys.some(k => k.includes("beta"))).toBe(false)
    expect(visibleKeys.some(k => k.includes("subtask"))).toBe(false)

    // Alpha and Gamma should still be visible
    expect(visibleKeys.some(k => k.includes("alpha"))).toBe(true)
    expect(visibleKeys.some(k => k.includes("gamma"))).toBe(true)
  })
})

// ── insert mode (quick-link filtering) ──────────────────────────────────────────

describe("insert-mode", () => {
  const g = loadFixture("insert-mode")

  // Mirrors the filter used by the Insert Link modal (searchResultsComputeAtom).
  function insertResults(query: string): ResultNode[] {
    const expr: QueryExpr = { type: "and", exprs: parseQuery(query, DEFAULT_SETTINGS.searchSeparator) }
    const keep = (n: ParsedNode) =>
      (n.nodeType === "page" || n.nodeType === "header") && matchQuery(n, expr)
    return pruneResultTree(search(g, query), keep)
  }

  function collectNodes(nodes: ResultNode[]): ParsedNode[] {
    const out: ParsedNode[] = []
    function walk(ns: ResultNode[]): void {
      for (const n of ns) { out.push(n.node); walk(n.children) }
    }
    walk(nodes)
    return out
  }

  it("shows only page and header nodes (no text/list-item lines)", () => {
    const nodes = collectNodes(insertResults("meeting"))
    expect(nodes.length).toBeGreaterThan(0)
    expect(nodes.every(n => n.nodeType === "page" || n.nodeType === "header")).toBe(true)
  })

  it("keeps the matching note's headers nested under it", () => {
    const keys = collectKeysFromResults(insertResults("meeting"))
    expect(keys).toContain("meeting notes|")
    expect(keys.some(k => k.includes("meeting notes#agenda"))).toBe(true)
    expect(keys.some(k => k.includes("meeting notes#action items"))).toBe(true)
  })

  it("excludes a note matched only by an inner content line", () => {
    // "standup" contains a line "[[roadmap]] meeting prep notes" but its own
    // name/headings do not contain "meeting", so it must not appear.
    const keys = collectKeysFromResults(insertResults("meeting"))
    expect(keys.some(k => k.includes("standup"))).toBe(false)
  })
})

// ── type-filters (is:/has: field syntax) ─────────────────────────────────────

describe("type-filters", () => {
  const g = loadFixture("type-filters")

  it("is:page finds the page root with its whole subtree, text lines included", () => {
    const keys = searchKeys(g, "is:page")
    expect(keys.some(k => k.includes("notes home"))).toBe(true)
    expect(keys.some(k => k.includes("groceries"))).toBe(true)
  })

  it("is:page -is:text (single stage) still keeps text lines: matching a node keeps its whole subtree", () => {
    const keys = searchKeys(g, "is:page -is:text")
    expect(keys.some(k => k.includes("notes home"))).toBe(true)
    expect(keys.some(k => k.includes("groceries"))).toBe(true)
  })

  it("is:page.-is:text (two stages) prunes text lines from within the matched page", () => {
    const keys = searchKeys(g, "is:page.-is:text")
    expect(keys.some(k => k.includes("notes home"))).toBe(true)
    expect(keys.some(k => k.includes("overview"))).toBe(true)
    expect(keys.some(k => k.includes("groceries"))).toBe(false)
  })

  it("has:emoji matches only nodes with an emoji in their search key", () => {
    const keys = searchKeys(g, "has:emoji")
    expect(keys).toHaveLength(0) // fixture has no emoji content
  })
})
