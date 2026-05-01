import { describe, it, expect } from "bun:test"
import { loadFixture, search, searchKeys } from "./helpers.ts"
import { partitionArchived } from "../../search/archive.ts"
import type { ResultNode } from "../../search/search.ts"

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
