import { describe, it, expect } from "bun:test"
import { loadFixture, search, searchKeys } from "./helpers.ts"
import { partitionArchived } from "../../search/archive.ts"
import { linkTargetTree, newLinkName, searchIndex, type ResultNode } from "../../search/search.ts"
import { DEFAULT_SETTINGS, indexSinglePage } from "../../graph/indexer.ts"
import { NotesGraph, getKey } from "../../graph/graph.ts"
import { parseVaultFile } from "../../parser/vault-file.ts"
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

// ── exclude-subtree ───────────────────────────────────────────────────────────

describe("exclude-subtree", () => {
  const g = loadFixture("exclude-subtree")

  it("a negated term next to a positive one drops matching lines with their subtrees", () => {
    expect(searchKeys(g, "parent . child -exclude")).toEqual(["parent", "child a", "child c"])
  })

  it("prunes excluded lines from the outline block a nested match is shown in", () => {
    expect(searchKeys(g, "child -exclude")).toEqual(["parent", "child a", "child c"])
  })

  it("drops a nested match whose outline block passes through an excluded line", () => {
    expect(searchKeys(g, "leaf -exclude")).toEqual(["other root", "stray leaf"])
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

  function insertResults(query: string): ResultNode[] {
    return linkTargetTree(g, query, DEFAULT_SETTINGS.searchSeparator)
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

  it("returns nothing below 3 characters", () => {
    expect(linkTargetTree(g, "me", ".")).toEqual([])
  })

  it("hides archived link targets", () => {
    const g2 = new NotesGraph()
    const files: Record<string, string> = {
      "Old plan.md": "---\ntags: [archive]\n---\n# Kickoff\n",
      "New plan.md": "# Kickoff\n",
    }
    for (const [path, content] of Object.entries(files)) {
      indexSinglePage(parseVaultFile(content, path, 1_700_000_000_000), g2, DEFAULT_SETTINGS)
    }
    const keys: string[] = []
    const walk = (ns: ResultNode[]) => ns.forEach(n => { keys.push(getKey(n.node)); walk(n.children) })
    walk(linkTargetTree(g2, "plan", "."))
    expect(keys).toContain("[[new plan]]")
    expect(keys).not.toContain("[[old plan]]")
  })

  describe("[[note#heading fragments", () => {
    const g2 = new NotesGraph()
    const files: Record<string, string> = {
      "Note.md": "# Header1\n",
      "Noting.md": "# Heading\n",
      "Notary.md": "# Summary\n",
      "Other.md": "# Not heavy\n",
    }
    for (const [path, content] of Object.entries(files)) {
      indexSinglePage(parseVaultFile(content, path, 1_700_000_000_000), g2, DEFAULT_SETTINGS)
    }
    const keys = (q: string) => collectKeysFromResults(linkTargetTree(g2, q, ".")).sort()

    it("matches the note part against the note name and the heading part against the heading", () => {
      expect(keys("not#hea")).toEqual(["note#header1", "noting#heading"])
      expect(keys("Noting#hea")).toEqual(["noting#heading"])
    })

    it("lists every heading of the matching notes when the heading part is empty", () => {
      expect(keys("notary#")).toEqual(["notary#summary"])
    })
  })

  describe("newLinkName", () => {
    const g2 = new NotesGraph()
    const files: Record<string, string> = {
      "AEP Testing plan.md": "---\naliases: [Quality doc]\n---\n# Scope\n",
      "Daily.md": "- [[Ghost note]] mention\n",
    }
    for (const [path, content] of Object.entries(files)) {
      indexSinglePage(parseVaultFile(content, path, 1_700_000_000_000), g2, DEFAULT_SETTINGS)
    }
    const t = (q: string) => linkTargetTree(g2, q, ".")
    const keys = (ns: ResultNode[]): string[] => ns.flatMap(n => [getKey(n.node), ...keys(n.children)])

    it("offers the typed name when only a longer note matches", () => {
      expect(keys(t("AEP testing"))).toContain("[[aep testing plan]]")
      expect(newLinkName(g2, "AEP testing", t("AEP testing"))).toBe("AEP testing")
    })

    it("trims the name", () => {
      expect(newLinkName(g2, "  New idea ", t("  New idea "))).toBe("New idea")
    })

    it("is null for an existing note, a reference-only note, or a target's alias", () => {
      expect(newLinkName(g2, "aep testing plan", t("aep testing plan"))).toBeNull()
      expect(newLinkName(g2, "ghost note", t("ghost note"))).toBeNull()
      expect(newLinkName(g2, "quality doc", t("quality doc"))).toBeNull()
    })

    it("is null for a blank name or one a link or file name can't hold", () => {
      for (const q of ["", "   ", "AEP#Scope", "a/b", "x|y", "blk^id", "a]b"]) expect(newLinkName(g2, q, [])).toBeNull()
    })
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

  it("an exclusion prunes text lines from within the matched page, in its own stage or alongside is:page", () => {
    for (const q of ["is:page -is:text", "is:page.-is:text"]) {
      const keys = searchKeys(g, q)
      expect(keys.some(k => k.includes("notes home"))).toBe(true)
      expect(keys.some(k => k.includes("overview"))).toBe(true)
      expect(keys.some(k => k.includes("groceries"))).toBe(false)
    }
  })

  it("has:emoji matches only nodes with an emoji in their search key", () => {
    const keys = searchKeys(g, "has:emoji")
    expect(keys).toHaveLength(0) // fixture has no emoji content
  })
})

// ── outline ───────────────────────────────────────────────────────────────────

describe('outline:<note> / outline:":daily"', () => {
  const g = loadFixture("outline")
  const daily = { dailyNote: "2026-10-03.md" }
  const DAILY_OUTLINE = ["2026-10-03|", "2026-10-03#morning", "project x|", "kickoff with [[bob]]", "call [[alice]] about #budget", "prep slides #todo"]

  it("outline:<note> is:page is the note's own outline as one tree, without links' other children", () => {
    const results = search(g, "outline:2026-10-03 is:page")
    expect(results.map(r => r.node.searchKey)).toEqual(["2026-10-03|"])
    // Linked notes' own bullets and their mentions elsewhere stay out; an inline link
    // doesn't repeat its line under the linked note.
    expect(collectKeysFromResults(results).sort()).toEqual([...DAILY_OUTLINE].sort())
  })

  it('outline:":daily" is:page targets the runtime\'s daily note, by path', () => {
    expect(collectKeysFromResults(searchIndex(g, 'outline:":daily" is:page', ".", daily)).sort()).toEqual([...DAILY_OUTLINE].sort())
  })

  it('outline:":daily" matches nothing when the runtime names no daily note', () => {
    expect(search(g, 'outline:":daily" is:page')).toEqual([])
  })

  it("other terms only match inside the outline", () => {
    expect(searchKeys(g, "budget")).toContain("budget review #finance")
    expect(searchKeys(g, "outline:2026-10-03 budget")).toEqual(["call [[alice]] about #budget", "prep slides #todo"])
  })

  it("a quoted name selects exactly that note, spaces included", () => {
    expect(searchKeys(g, "outline:\"project x\" is:page")).toEqual(["project x|", "milestone [[q4]]"])
  })

  it("a quoted name never matches a fragment", () => {
    expect(search(g, "outline:\"2026-10\"")).toEqual([])
  })

  it("a bare fragment picks the most recent matching note", () => {
    expect(searchKeys(g, "outline:2026-10 is:page")[0]).toBe("2026-10-03|")
    expect(searchKeys(g, "outline:10-01 is:page")[0]).toBe("2026-10-01|")
  })

  it("a bare name equal to a note's name picks that note over newer fragment matches", () => {
    expect(searchKeys(g, "outline:2026-10-01 is:page")[0]).toBe("2026-10-01|")
  })

  it("an unknown note matches nothing", () => {
    expect(search(g, "outline:nowhere")).toEqual([])
  })
})

describe("[[note]] scope", () => {
  const g = loadFixture("outline")

  it("is the note's full subtree, including children written in other notes", () => {
    const results = search(g, "[[Project X]]")
    expect(results.map(r => r.node.searchKey)).toEqual(["project x|"])
    expect(collectKeysFromResults(results).sort())
      .toEqual(["budget review #finance", "kickoff with [[bob]]", "milestone [[q4]]", "project x|"])
    // Unlike its own outline, which stops at Project X.md.
    expect(searchKeys(g, "outline:\"project x\" is:page")).toEqual(["project x|", "milestone [[q4]]"])
  })

  it("reaches past the note's own file into linked notes' children", () => {
    expect(searchKeys(g, "[[2026-10-03]]")).toContain("budget review #finance")
  })

  it("targets a note that exists only as a link", () => {
    const results = search(g, "[[Bob]]")
    expect(results.map(r => r.node.searchKey)).toEqual(["bob"])
    expect(results[0].children.map(c => c.node.searchKey)).toEqual(["kickoff with [[bob]]"])
  })

  it("other terms only match inside the tree", () => {
    expect(searchKeys(g, "[[Project X]] budget")).toEqual(["budget review #finance"])
  })

  it("intersects with outline:", () => {
    const keys = searchKeys(g, "outline:2026-10-03 [[Project X]]")
    expect(keys).toContain("kickoff with [[bob]]")
    expect(keys).not.toContain("budget review #finance")
    expect(keys).not.toContain("milestone [[q4]]")
  })

  it("roots the tree at a heading", () => {
    expect(search(g, "[[2026-10-03#Morning]]")[0].node.searchKey).toBe("2026-10-03#morning")
    expect(searchKeys(g, "[[2026-10-03#Morning]]")).toContain("call [[alice]] about #budget")
  })

  it("an unknown note or heading matches nothing", () => {
    expect(search(g, "[[nowhere]]")).toEqual([])
    expect(search(g, "[[2026-10-03#Nowhere]]")).toEqual([])
  })

  it("an open [[fragment is the link-target list", () => {
    const results = search(g, "[[proj")
    expect(results.length).toBeGreaterThan(0)
    expect(results).toEqual(linkTargetTree(g, "proj", DEFAULT_SETTINGS.searchSeparator))
  })
})
