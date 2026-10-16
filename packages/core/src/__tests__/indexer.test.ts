import { describe, it, expect } from "bun:test"
import { NotesGraph } from "../graph/graph.ts"
import type { TextNode } from "../graph/types.ts"
import { indexSinglePage, DEFAULT_SETTINGS } from "../graph/indexer.ts"
import { parseVaultFile } from "../parser/vault-file.ts"
import { searchIndex } from "../search/search.ts"
import { partitionArchived } from "../search/archive.ts"
import { parseQuery, extractArchiveReveal } from "../search/query.ts"

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

    it("archived page (frontmatter tag) is indexed but marked archived", () => {
      const g = buildGraph(
        parse("---\ntags:\n  - archive\n---\n\n## Section\n\n- buy milk #groceries", "old.md"),
      )
      // Page node exists and is intrinsically archived
      expect(g.hasNode("[[old]]")).toBe(true)
      expect(g.getNodeAttributes("[[old]]").archived).toBe(true)
      // Its body is now indexed (no longer excluded); the header exists and the
      // text line carries the archived flag so it is hidden by default but
      // revealable via is:archived.
      expect(g.hasNode("old#section")).toBe(true)
      // Headers inside an archived page are marked archived too (they belong to
      // exactly one page, so this is unambiguous).
      expect(g.getNodeAttributes("old#section").archived).toBe(true)
      const textNodes = g.filterNodes((_, n) => n.nodeType === "text")
      expect(textNodes).toHaveLength(1)
      expect(g.getNodeAttributes(textNodes[0]).archived).toBe(true)
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

  describe("nesting: nested / list / inherited date", () => {
    const textNode = (g: NotesGraph, key: string) => g.getNodeAttributes(key) as TextNode

    it("flags nested lines and lists, and inherits the earliest open subtask date", () => {
      const g = buildGraph(parse(
        "- [[P]]\n   - [ ] parent [scheduled:: 2026-10-20]\n      - [ ] a [scheduled:: 2026-10-10]\n      - [x] b [scheduled:: 2026-10-01]\n      - c #x\n   - [ ] plain",
        "n.md",
      ))
      const parent = textNode(g, "parent [scheduled:: 2026-10-20]")
      const a = textNode(g, "a [scheduled:: 2026-10-10]")
      expect(parent.list).toBe(true)
      expect(parent.nested).toBeUndefined()
      expect(parent.inheritedDate).toBe("2026-10-10")
      expect(parent.ageDays).toBe(a.ageDays)
      expect(a.nested).toBe(true)
      const c = textNode(g, "c #x")
      expect(c.nested).toBe(true)
      expect(c.isTask).toBe(false)
      const plain = textNode(g, "plain")
      expect([plain.nested, plain.list, plain.inheritedDate]).toEqual([undefined, undefined, undefined])
    })

    it("an undated parent takes its dated open subtask's date", () => {
      const g = buildGraph(parse("- [ ] parent\n    - [ ] sub [scheduled:: 2026-10-10]", "n.md"))
      const parent = textNode(g, "parent")
      expect(parent.inheritedDate).toBe("2026-10-10")
      expect(parent.ageDays).toBe(textNode(g, "sub [scheduled:: 2026-10-10]").ageDays)
    })

    it("a parent dated earlier than its subtasks keeps its own date", () => {
      const g = buildGraph(parse("- [ ] parent [scheduled:: 2026-10-01]\n    - [ ] sub [scheduled:: 2026-10-10]", "n.md"))
      const parent = textNode(g, "parent [scheduled:: 2026-10-01]")
      expect(parent.inheritedDate).toBeUndefined()
      expect(parent.ageDays).toBeGreaterThan(textNode(g, "sub [scheduled:: 2026-10-10]").ageDays)
    })

    it("a subtask stamped [created::] before its [scheduled::] is dated by the schedule, so the parent keeps its own date", () => {
      const g = buildGraph(parse(
        "- [ ] parent [scheduled:: 2026-10-10]\n    - [ ] sub #task [created:: 2026-09-27] [scheduled:: 2026-10-12]",
        "n.md",
      ))
      const parent = textNode(g, "parent [scheduled:: 2026-10-10]")
      const sub = textNode(g, "sub #task [created:: 2026-09-27] [scheduled:: 2026-10-12]")
      expect(sub.ageDays).toBe(textNode(buildGraph(parse("- [ ] t 2026-10-12", "m.md")), "t 2026-10-12").ageDays)
      expect(parent.inheritedDate).toBeUndefined()
      expect(parent.ageDays).toBe(sub.ageDays + 2)
    })

    it("inherits only scheduled/due dates, not [created::] or other dates in a subtask", () => {
      const g = buildGraph(parse(
        "- [ ] parent [scheduled:: 2026-10-20]\n    - [ ] moved [created:: 2026-10-01]\n    - [ ] review [[2026-09-30]] notes\n" +
          "- [ ] list\n    - [ ] sub\n        - [ ] leaf [scheduled:: 2026-10-05]\n        - [ ] old [created:: 2026-09-01]",
        "n.md",
      ))
      const parent = textNode(g, "parent [scheduled:: 2026-10-20]")
      expect(parent.inheritedDate).toBeUndefined()
      expect(parent.ageDays).toBe(textNode(buildGraph(parse("- [ ] t 2026-10-20", "m.md")), "t 2026-10-20").ageDays)
      expect(textNode(g, "list").inheritedDate).toBe("2026-10-05")
    })

    it("indexes a prose child that carries [created:: date], dated by it", () => {
      const g = buildGraph(parse("- [ ] buy milk\n    - check price [created:: 2026-10-07]\n    - plain prose\n", "n.md"))
      const child = textNode(g, "check price [created:: 2026-10-07]")
      expect(child).toBeDefined()
      expect(g.hasNode("plain prose")).toBe(false)
      expect(g.hasEdge("buy milk", "check price [created:: 2026-10-07]")).toBe(true)
      const dated = buildGraph(parse("- [ ] t [scheduled:: 2026-10-07]", "m.md"))
      expect(child.ageDays).toBe(textNode(dated, "t [scheduled:: 2026-10-07]").ageDays)
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

  it("shows a nested match inside its outline block", () => {
    const g = buildGraph(parse("- [[P]]\n   - [ ] parent\n      - [ ] alpha sub\n      - [ ] beta sub\n", "n.md"))
    const results = searchIndex(g, "alpha", ".")
    expect(results.map(r => r.node.searchKey)).toEqual(["parent"])
    expect(results[0].children.map(c => c.node.searchKey)).toEqual(["alpha sub", "beta sub"])
  })

  it("an embed is not a parent: the line stays under its links only", () => {
    const line = "[[Spark Cost]] ![[ibm-image-1.png]] ![[Ibm Notes]]"
    const g = buildGraph(parse(`- [[IBM]]\n    - ${line}\n`, "2026-10-01.md"))
    expect(g.hasNode("[[ibm-image-1.png]]")).toBe(false)
    expect(g.hasNode("[[ibm notes]]")).toBe(false)
    const roots = searchIndex(g, "ibm", ".")
    expect(roots.map(r => r.node.searchKey)).toEqual(["ibm"])
    expect(roots[0].children.map(c => c.node.searchKey)).toEqual([line.toLowerCase()])
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

describe("archive tag", () => {
  const textAttrs = (g: NotesGraph, text: string) =>
    g.getNodeAttributes(g.filterNodes((_, n) => n.nodeType === "text" && n.searchKey.includes(text))[0])
  const marks = (n: { archived?: boolean; archiveInherited?: true }) => [n.archived, n.archiveInherited]

  it("marks a tagged line own and the lines under it inherited", () => {
    const g = buildGraph(parse("- old plan #archive\n    - step one #todo\n- live plan #todo", "n.md"))
    expect(marks(textAttrs(g, "old plan"))).toEqual([true, undefined])
    expect(marks(textAttrs(g, "step one"))).toEqual([true, true])
    expect(marks(textAttrs(g, "live plan"))).toEqual([undefined, undefined])
  })

  it("marks a heading archived from its next line, with descendants inherited", () => {
    const g = buildGraph(parse("## Old\n- #archive\n- one #todo\n### Sub\n- two #todo\n## New\n- three #todo", "n.md"))
    expect(marks(g.getNodeAttributes("n#old"))).toEqual([true, undefined])
    expect(marks(g.getNodeAttributes("n#sub"))).toEqual([true, true])
    expect(marks(g.getNodeAttributes("n#new"))).toEqual([undefined, undefined])
    expect(marks(textAttrs(g, "one"))).toEqual([true, true])
    expect(marks(textAttrs(g, "two"))).toEqual([true, true])
    expect(marks(textAttrs(g, "three"))).toEqual([undefined, undefined])
  })

  it("does not archive a note linked by a bare link line under an archived heading", () => {
    const g = buildGraph(parse("## Old\n- #archive\n- [[Project]]\n    - kickoff #todo", "n.md"))
    expect(g.getNodeAttributes("[[project]]").archived).toBeUndefined()
    expect(marks(textAttrs(g, "kickoff"))).toEqual([true, true])
  })

  it("hides a line under an archived line also where it shows under the note it links to", () => {
    const g = buildGraph(parse("- old plan #archive\n    - call [[Bob]] about it #todo", "n.md"))
    const [lineKey] = g.outboundEdgeEntries("[[bob]]").map(e => e.target)
    expect(lineKey).toBe("call [[bob]] about it #todo")
    const underBob = [{ node: g.getNodeAttributes("[[bob]]"), parents: [], children: [{ node: g.getNodeAttributes(lineKey), parents: [], children: [] }] }]
    expect(partitionArchived(underBob, false)).toEqual({ visible: [{ ...underBob[0], effectiveArchived: false, children: [] }], archivedCount: 1 })
  })
})

describe("archive visibility (end-to-end)", () => {
  const alphaTree = "- project alpha #archive\n    - deep alpha task #todo"

  it("hides an archived subtree (and its non-archived descendants) by default", () => {
    const g = buildGraph(parse(alphaTree, "n.md"))
    const { visible, archivedCount } = partitionArchived(searchIndex(g, "alpha", "."), false)
    expect(visible).toHaveLength(0)
    expect(archivedCount).toBeGreaterThan(0)
  })

  it("reveals the archived subtree greyed with `alpha is:archived`", () => {
    const g = buildGraph(parse(alphaTree, "n.md"))
    const q = "alpha is:archived"
    const { reveal } = extractArchiveReveal(parseQuery(q, "."))
    expect(reveal).toBe(true)
    const { visible } = partitionArchived(searchIndex(g, q, "."), reveal)
    expect(visible.length).toBeGreaterThan(0)
    // The archived root and its descendant are both stamped effectiveArchived.
    expect(visible[0].effectiveArchived).toBe(true)
    expect(visible[0].children.every(c => c.effectiveArchived)).toBe(true)
  })

  it("keeps a page archived even when referenced (merged) from another file", () => {
    // Regression: a bare `[[Old Note]]` reference from a live page merges a
    // reference PageNode (archived undefined) into the real one; the merge must
    // not clear the archived flag, or the archived page leaks into results.
    const g = buildGraph(
      parse("---\ntags:\n  - archive\n---\n\n## Section\n\n- stale thing #todo", "Old Note.md"),
      parse("- see [[Old Note]] for context #todo", "Live.md"),
    )
    expect(g.getNodeAttributes("[[old note]]").archived).toBe(true)
    // A plain search for a term unique to the archived page's body finds nothing
    // visible (the archived subtree is hidden); revealing brings it back.
    expect(partitionArchived(searchIndex(g, "stale thing", "."), false).visible).toHaveLength(0)
    expect(partitionArchived(searchIndex(g, "stale thing is:archived", "."), true).visible.length).toBeGreaterThan(0)
  })

  it("bare is:archived surfaces only archived items", () => {
    const g = buildGraph(parse("- keep me #todo\n- toss me #archive", "n.md"))
    const q = "is:archived"
    const { reveal } = extractArchiveReveal(parseQuery(q, "."))
    const { visible } = partitionArchived(searchIndex(g, q, "."), reveal)
    expect(visible.length).toBeGreaterThan(0)
    expect(visible.every(n => n.effectiveArchived)).toBe(true)
    expect(visible.some(n => n.node.searchKey.includes("keep me"))).toBe(false)
  })
})

describe("parent edge tags", () => {
  function inboundTags(g: NotesGraph, lineText: string) {
    const [key] = g.filterNodes((_, n) => n.nodeType === "text" && n.searchKey.includes(lineText))
    return Object.fromEntries(g.inboundEdgeEntries(key).map(e => [e.source, e.attributes.inline]))
  }

  it("tags the edge from a linked note inline and leaves the outline edge untagged", () => {
    const g = buildGraph(parse("- [[UAE]]\n    - [[Rares Vlasceanu]] [analysis for requirements](https://example.com/a)", "2026-10-01.md"))
    expect(inboundTags(g, "analysis for requirements")).toStrictEqual({ "[[uae]]": undefined, "[[rares vlasceanu]]": true })
  })

  it("keeps the outline edge untagged when the line also links its outline parent", () => {
    const g = buildGraph(parse("- [[UAE]]\n    - [[UAE]] sync with [[Bob]] https://example.com/b", "2026-10-01.md"))
    expect(inboundTags(g, "sync with")).toStrictEqual({ "[[uae]]": undefined, "[[bob]]": true })
  })
})
