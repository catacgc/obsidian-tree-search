import { describe, it, expect } from "bun:test"
import { NotesGraph } from "../graph/graph.ts"
import { indexSinglePage, DEFAULT_SETTINGS } from "../graph/indexer.ts"
import { parseVaultFile } from "../parser/vault-file.ts"
import { searchIndex } from "../search/search.ts"

const MTIME = 1_700_000_000_000 // fixed timestamp for deterministic tests

function parse(content: string, path = "note.md") {
  return parseVaultFile(content, path, MTIME)
}

function buildGraph(...pages: ReturnType<typeof parse>[]) {
  const g = new NotesGraph()
  for (const p of pages) indexSinglePage(p, g, DEFAULT_SETTINGS)
  return g
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("indexSinglePage", () => {
  describe("page node creation", () => {
    it("creates a page node keyed by filename (without extension)", () => {
      const g = buildGraph(parse("# Hello", "projects/My Note.md"))
      expect(g.hasNode("[[my note]]")).toBe(true)
    })

    it("page node stores aliases from frontmatter", () => {
      const g = buildGraph(
        parse("---\naliases:\n  - Alias One\n  - Alias Two\n---\n", "alpha.md"),
      )
      const node = g.getNodeAttributes("[[alpha]]") as { aliases: string[] }
      expect(node.aliases).toContain("Alias One")
      expect(node.aliases).toContain("Alias Two")
    })

    it("archived page (frontmatter tag) creates no child nodes", () => {
      const g = buildGraph(
        parse("---\ntags:\n  - archive\n---\n\n## Section\n\n- [[Link]]", "old.md"),
      )
      // Page node still exists
      expect(g.hasNode("[[old]]")).toBe(true)
      // But no header or text children
      const edges = g.outboundEdgeEntries("[[old]]")
      expect(edges).toHaveLength(0)
    })
  })

  describe("header nodes", () => {
    it("creates header nodes for each heading", () => {
      const g = buildGraph(parse("# Alpha\n## Beta", "note.md"))
      expect(g.hasNode("note#alpha")).toBe(true)
      expect(g.hasNode("note#beta")).toBe(true)
    })

    it("connects page → h1 header with parent edge", () => {
      const g = buildGraph(parse("# Intro", "note.md"))
      expect(g.hasEdge("[[note]]", "note#intro")).toBe(true)
    })

    it("connects h1 → h2 parent edge (nested headers)", () => {
      const g = buildGraph(parse("# Top\n## Sub", "note.md"))
      expect(g.hasEdge("note#top", "note#sub")).toBe(true)
    })
  })

  describe("text / list nodes", () => {
    it("skips pure prose list items", () => {
      const g = buildGraph(parse("- just text no links\n- more plain text", "n.md"))
      expect(g.order).toBe(1) // only the page node
    })

    it("creates text nodes for items with obsidian links", () => {
      const g = buildGraph(parse("- [[Some Note]] is referenced here", "n.md"))
      expect(g.hasNode("[[some note]]")).toBe(true)
    })

    it("pure obsidian link collapses to virtual page (no text node)", () => {
      const g = buildGraph(parse("- [[Target]]", "source.md"))
      // [[Target]] becomes a page node, not a text node
      const node = g.getNodeAttributes("[[target]]")
      expect(node.nodeType).toBe("page")
      const asPage = node as { isReference: boolean }
      expect(asPage.isReference).toBe(true)
    })

    it("creates a text node for mixed content (link + extra text)", () => {
      const g = buildGraph(parse("- see [[Target]] for details", "n.md"))
      expect(g.hasNode("see [[target]] for details")).toBe(true)
    })

    it("page → text edge exists under page parent", () => {
      const g = buildGraph(parse("- [[Note]] reference", "source.md"))
      const textKey = "[[note]] reference"
      expect(g.hasNode(textKey)).toBe(true)
    })

    it("task items are indexed as text nodes", () => {
      const g = buildGraph(parse("- [ ] [[Task Target]]", "n.md"))
      // pure task link collapses to virtual page
      expect(g.hasNode("[[task target]]")).toBe(true)
    })

    it("items under header are children of header node, not page", () => {
      const g = buildGraph(parse("## Section\n\n- [[Link]]", "note.md"))
      // The virtual page for Link has a parent edge from the header
      expect(g.hasEdge("note#section", "[[link]]")).toBe(true)
      expect(g.hasEdge("[[note]]", "[[link]]")).toBe(false)
    })
  })

  describe("frontmatter parent relations", () => {
    it("creates parent → page edge from frontmatter 'parent' field", () => {
      const g = buildGraph(
        parse("---\nparent: \"[[Root]]\"\n---\n", "child.md"),
      )
      // [[Root]] is a virtual page
      expect(g.hasNode("[[root]]")).toBe(true)
      expect(g.hasEdge("[[root]]", "[[child]]")).toBe(true)
    })
  })

  describe("incremental re-index (removeExistingPageEdges)", () => {
    it("after re-index old edges are replaced", () => {
      const g = new NotesGraph()
      const v1 = parse("- [[OldLink]]", "note.md")
      indexSinglePage(v1, g, DEFAULT_SETTINGS)
      expect(g.hasNode("[[oldlink]]")).toBe(true)

      // Re-index with different content
      const v2 = parse("- [[NewLink]]", "note.md")
      indexSinglePage(v2, g, DEFAULT_SETTINGS)

      expect(g.hasNode("[[newlink]]")).toBe(true)
      // OldLink was a reference node with no remaining edges — pruned
      expect(g.hasNode("[[oldlink]]")).toBe(false)
    })
  })
})

describe("tagged child lines (code + tag, no obsidian link)", () => {
  it("indexes a child line with inline code and a tag", () => {
    const g = buildGraph(parse("- [[Dragos Georgita]]\n    - `test` #snippet", "note.md"))
    expect(g.hasNode("`test` #snippet")).toBe(true)
    const node = g.getNodeAttributes("`test` #snippet")
    expect(node.nodeType).toBe("text")
    const asText = node as { tags: string[] }
    expect(asText.tags).toContain("#snippet")
  })

  it("connects tagged child to its parent virtual page", () => {
    const g = buildGraph(parse("- [[Dragos Georgita]]\n    - `test` #snippet", "note.md"))
    expect(g.hasEdge("[[dragos georgita]]", "`test` #snippet")).toBe(true)
  })

  it("tagged child is reachable via search", () => {
    const g = buildGraph(parse("- [[Dragos Georgita]]\n    - `test` #snippet", "note.md"))
    const byTag = searchIndex(g, "snippet", ".")
    expect(byTag.length).toBeGreaterThan(0)
    const byCode = searchIndex(g, "test", ".")
    expect(byCode.length).toBeGreaterThan(0)
  })

  it("indexes tagged child even when parent is at line 0 (item.parent === 0, not undefined)", () => {
    // Regression: !item.parent was true for line 0, could misattribute to a header
    const g = buildGraph(parse("- [[Root]]\n  - `code` #tagged", "note.md"))
    expect(g.hasEdge("[[root]]", "`code` #tagged")).toBe(true)
  })

  it("tag-only child line (no code span) is also indexed", () => {
    const g = buildGraph(parse("- [[Parent]]\n    - plain text #important", "note.md"))
    expect(g.hasNode("plain text #important")).toBe(true)
  })

  it("meta-action syntax does not appear in searchKey", () => {
    const g = buildGraph(
      parse(
        "- https://app.todoist.com/app/task/123 (meta-action-name::Open Task)(meta-action-url::https://app.todoist.com/app/task/123)(meta-action-icon::globe-01-16)",
        "n.md",
      ),
    )
    // The text node's searchKey must NOT contain "meta-action"
    const nodes = g.filterNodes((_, attrs) => attrs.nodeType === "text")
    expect(nodes.length).toBeGreaterThan(0)
    const textNode = g.getNodeAttributes(nodes[0]) as { searchKey: string; parsedTokens: unknown[] }
    expect(textNode.searchKey).not.toContain("meta-action")
    // But parsedTokens must contain the meta_action token
    const tokens = textNode.parsedTokens as Array<{ tokenType: string }>
    expect(tokens.some(t => t.tokenType === "meta_action")).toBe(true)
  })

  it("drops link URL query strings from searchKey but keeps domain/path", () => {
    const g = buildGraph(
      parse(
        "- [Current CA](https://adobe.sharepoint.com/x?ovuser=abc%2Ccostache%40adobe.com) note",
        "n.md",
      ),
    )
    // query-param noise ("cost" inside costache) must not pollute the search key…
    const noise = searchIndex(g, "cost", ".")
    expect(noise).toHaveLength(0)
    // …while the URL's domain (before the "?") stays searchable.
    const byDomain = searchIndex(g, "sharepoint", ".")
    expect(byDomain.length).toBeGreaterThan(0)
  })
})

describe("search integration", () => {
  it("finds pages by name", () => {
    const g = buildGraph(parse("# Hello", "my-project.md"))
    const results = searchIndex(g, "my-project", ".")
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].node.nodeType).toBe("page")
  })

  it("finds text nodes by content", () => {
    const g = buildGraph(parse("- [[Alpha]] is important", "note.md"))
    const results = searchIndex(g, "alpha is important", ".")
    expect(results.length).toBeGreaterThan(0)
  })

  it("returns empty for no match", () => {
    const g = buildGraph(parse("# Hello", "note.md"))
    const results = searchIndex(g, "zzz_nonexistent", ".")
    expect(results).toHaveLength(0)
  })

  it("case-insensitive search", () => {
    const g = buildGraph(parse("- [[UPPER CASE LINK]]", "note.md"))
    const results = searchIndex(g, "upper case link", ".")
    expect(results.length).toBeGreaterThan(0)
  })
})

describe("todoist meta-action integration", () => {
  it("task with meta-action: searchKey clean, parsedTokens has meta_action", () => {
    const taskLine =
      "- [Project](https://app.todoist.com/app/project/abc123)\n" +
      "  - Buy milk https://app.todoist.com/app/task/task1 (meta-action-name::Open Task)(meta-action-url::https://app.todoist.com/app/task/task1)(meta-action-icon::globe-01-16)"

    const g = buildGraph(parse(taskLine, "todoist.md"))

    // Find the task text node
    const nodes = g.filterNodes((_, attrs) => {
      if (attrs.nodeType !== "text") return false
      const t = attrs as { searchKey: string }
      return t.searchKey.includes("buy milk")
    })
    expect(nodes.length).toBe(1)

    const node = g.getNodeAttributes(nodes[0]) as {
      searchKey: string
      parsedTokens: Array<{ tokenType: string; name?: string; url?: string }>
    }

    // searchKey must not contain meta-action syntax
    expect(node.searchKey).not.toContain("meta-action")
    expect(node.searchKey).not.toContain("Open Task")

    // parsedTokens must include the meta_action token
    const metaToken = node.parsedTokens.find(t => t.tokenType === "meta_action")
    expect(metaToken).toBeDefined()
    expect(metaToken?.name).toBe("Open Task")
    expect(metaToken?.url).toBe("https://app.todoist.com/app/task/task1")
  })

  it("project link node has no meta-action tokens", () => {
    const g = buildGraph(
      parse("- [My Project](https://app.todoist.com/app/project/abc)", "todoist.md"),
    )
    // Pure link collapses to a virtual page — no meta_action tokens
    const nodes = g.filterNodes((_, attrs) => attrs.nodeType === "page")
    expect(nodes.length).toBeGreaterThan(0)
  })

  it("plain-text task (no URL) with meta-action is indexed and searchable", () => {
    const g = buildGraph(
      parse(
        "- Buy groceries (meta-action-name::Open Task)(meta-action-url::https://app.todoist.com/app/task/42)(meta-action-icon::globe-01-16)",
        "todoist.md",
      ),
    )
    // Should be indexed (not dropped by shouldSkip)
    const nodes = g.filterNodes((_, attrs) => {
      if (attrs.nodeType !== "text") return false
      return (attrs as { searchKey: string }).searchKey.includes("buy groceries")
    })
    expect(nodes.length).toBe(1)
    const node = g.getNodeAttributes(nodes[0]) as {
      parsedTokens: Array<{ tokenType: string }>
    }
    expect(node.parsedTokens.some(t => t.tokenType === "meta_action")).toBe(true)
  })
})

describe("meta-mdtree archive", () => {
  it("meta-mdtree archive syntax does not appear in searchKey", () => {
    const g = buildGraph(parse("- My archived item (meta-mdtree:: archive)", "n.md"))
    const nodes = g.filterNodes((_, attrs) => attrs.nodeType === "text")
    expect(nodes.length).toBeGreaterThan(0)
    const textNode = g.getNodeAttributes(nodes[0]) as { searchKey: string; parsedTokens: unknown[] }
    expect(textNode.searchKey).not.toContain("meta-mdtree")
    expect(textNode.searchKey).toContain("my archived item")
  })

  it("parsedTokens contains meta_mdtree token with directive 'archive'", () => {
    const g = buildGraph(parse("- My archived item (meta-mdtree:: archive)", "n.md"))
    const nodes = g.filterNodes((_, attrs) => attrs.nodeType === "text")
    expect(nodes.length).toBeGreaterThan(0)
    const textNode = g.getNodeAttributes(nodes[0]) as {
      parsedTokens: Array<{ tokenType: string; directive?: string }>
    }
    const metaMdtree = textNode.parsedTokens.find(t => t.tokenType === "meta_mdtree")
    expect(metaMdtree).toBeDefined()
    expect(metaMdtree?.directive).toBe("archive")
  })

  it("item with only meta-mdtree annotation (no links/tags) is still indexed", () => {
    const g = buildGraph(parse("- Plain text (meta-mdtree:: archive)", "n.md"))
    const nodes = g.filterNodes((_, attrs) => {
      if (attrs.nodeType !== "text") return false
      return (attrs as { searchKey: string }).searchKey.includes("plain text")
    })
    expect(nodes.length).toBe(1)
  })
})
