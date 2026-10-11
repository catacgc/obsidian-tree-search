import { describe, it, expect } from "bun:test"
import type { ParsedNode, TextNode, PageNode } from "../graph/types.ts"
import type { ResultNode } from "../search/search.ts"
import { UNDATED_AGE } from "../graph/boost.ts"
import { parseQuery } from "../search/query.ts"
import { buildTimeline, fileParent, outlineContext } from "../search/timeline.ts"
import { NotesGraph, getKey } from "../graph/graph.ts"
import { indexSinglePage, DEFAULT_SETTINGS } from "../graph/indexer.ts"
import { parseVaultFile } from "../parser/vault-file.ts"

// ── Test helpers ──────────────────────────────────────────────────────────────

function textNode(searchKey: string, ageDays: number): TextNode {
  return {
    nodeType: "text",
    searchKey,
    parsedTokens: [],
    tags: [],
    isTask: false,
    isCompleted: false,
    location: { path: "test.md", position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } } },
    boost: 0,
    ageDays,
  }
}

function pageNode(key: string, ageDays = UNDATED_AGE): PageNode {
  return {
    nodeType: "page",
    searchKey: key,
    isReference: false,
    page: key,
    aliases: [],
    tags: [],
    location: { path: `${key}.md`, position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } } },
    boost: 0,
    ageDays,
  }
}

function rn(node: ParsedNode, children: ResultNode[] = []): ResultNode {
  return { node, children, parents: [] }
}

const keys = (items: { node: ParsedNode }[]) => items.map(i => i.node.searchKey)

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildTimeline", () => {
  it("emits only last-stage hits, newest first, with matched-ancestor breadcrumbs", () => {
    const ibm = pageNode("IBM")
    const spark = textNode("Spark", 10)
    const arch = textNode("Spark architecture", 2)
    // A non-matching sub-item of a hit is tree context (dimmed there), not a timeline item.
    const sub = textNode("unrelated", 1)
    const tree = [rn(ibm, [rn(spark, [rn(arch), rn(sub)])]), rn(textNode("elsewhere", 0))]

    const items = buildTimeline(tree, parseQuery("ibm . spark", "."))

    expect(keys(items)).toEqual(["Spark architecture", "Spark"])
    expect(items[0].breadcrumb).toEqual([ibm, spark])
    expect(items[1].breadcrumb).toEqual([ibm])
  })

  it("applies the target stage's type filter to every item, not just the subtree root", () => {
    const page = pageNode("Data governance", 3)
    const childPage = pageNode("Data governance archive", 1)
    const tree = [rn(page, [rn(textNode("governance review", 2)), rn(childPage), rn(pageNode("Unrelated", 0))])]

    expect(keys(buildTimeline(tree, parseQuery("governa is:page", ".")))).toEqual(["Data governance archive", "Data governance"])
  })

  it("pins emoji hits on top but keeps them inside the recency window", () => {
    const tree = [
      rn(textNode("spark old", 400)),
      rn(textNode("spark 🚀 idea", UNDATED_AGE)),
      rn(textNode("spark 🎉 old", 400)),
      rn(textNode("spark 🔥 new", 5)),
      rn(textNode("spark new", 3)),
    ]
    const stages = parseQuery("spark", ".")

    // No window: every emoji hit is shown and pinned, undated ones included.
    const all = buildTimeline(tree, stages)
    expect(keys(all)).toEqual(["spark 🔥 new", "spark 🎉 old", "spark 🚀 idea", "spark new", "spark old"])
    expect(all.slice(0, 3).every(i => i.pinned)).toBe(true)

    // A window drops emoji hits older than it (or undated), like any other hit.
    expect(keys(buildTimeline(tree, stages, 7))).toEqual(["spark 🔥 new", "spark new"])
  })

  it("drops emoji hits older than an in: window in the query", () => {
    const tree = [rn(textNode("spark 🎉 old", 400)), rn(textNode("spark 🔥 new", 5)), rn(textNode("spark new", 3))]
    expect(keys(buildTimeline(tree, parseQuery("spark in:7d", ".")))).toEqual(["spark 🔥 new", "spark new"])
  })

  it("excludes undated non-emoji hits when no fallback date is available", () => {
    const tree = [rn(textNode("spark undated", UNDATED_AGE)), rn(textNode("spark dated", 5))]
    const stages = parseQuery("spark", ".")
    expect(keys(buildTimeline(tree, stages))).toEqual(["spark dated"])
    expect(keys(buildTimeline(tree, stages, null, () => null))).toEqual(["spark dated"])
  })

  it("dates undated hits via the fallback, which drives order and the window", () => {
    const undated = textNode("spark undated", UNDATED_AGE)
    const tree = [rn(undated), rn(textNode("spark dated", 5)), rn(textNode("spark own date", 40))]
    const stages = parseQuery("spark", ".")
    // Only undated nodes consult the fallback; own dates always win.
    const fallback = (n: ParsedNode) => n === undated ? 2 : 999

    const items = buildTimeline(tree, stages, null, fallback)
    expect(keys(items)).toEqual(["spark undated", "spark dated", "spark own date"])
    expect(items.map(i => i.ageDays)).toEqual([2, 5, 40])

    expect(keys(buildTimeline(tree, stages, 30, fallback))).toEqual(["spark undated", "spark dated"])
  })

  it("dedups repeated nodes, keeping the longer breadcrumb", () => {
    const parent = textNode("spark parent", 20)
    const child = textNode("spark child", 1)
    const tree = [rn(textNode("spark child", 1)), rn(parent, [rn(child)])]

    const items = buildTimeline(tree, parseQuery("spark", "."))

    expect(keys(items)).toEqual(["spark child", "spark parent"])
    expect(items[0].node).toBe(child)
    expect(items[0].breadcrumb).toEqual([parent])
  })

  it("lists open tasks first, oldest first (overdue, today, future), then other rows newest first", () => {
    const task = (key: string, ageDays: number, done = false): TextNode =>
      ({ ...textNode(key, ageDays), isTask: true, isCompleted: done })
    const tree = [rn(pageNode("P", 0), [
      rn(textNode("x note new", 1)), rn(task("x due tomorrow", -1)), rn(task("x done", 0, true)),
      rn(task("x overdue", 5)), rn(textNode("x note old", 9)), rn(task("x today", 0)), rn(task("x 2027", -400)),
    ])]

    expect(keys(buildTimeline(tree, parseQuery("x", ".")))).toEqual([
      "x overdue", "x today", "x due tomorrow", "x 2027", "x done", "x note new", "x note old",
    ])
  })

  it("shows a hit inside a list as one block item with compacted preview lines", () => {
    const listRoot: TextNode = { ...textNode("list root", 3), list: true }
    const subs = ["sub one", "sub x two", "sub three", "sub four"].map(k => ({ ...textNode(k, 3), nested: true as const }))
    const items = buildTimeline([rn(listRoot, subs.map(s => rn(s)))], parseQuery("x", "."))
    expect(items.map(i => i.node)).toEqual([listRoot])
    expect(items[0].block?.map(l => [l.node.searchKey, l.matched, l.preview])).toEqual([
      ["sub one", false, true],
      ["sub x two", true, true],
      ["sub three", false, true],
      ["sub four", false, false],
    ])
  })
})

describe("fileParent", () => {
  const g = new NotesGraph()
  // Plain lines without a link/tag/URL are not indexed, hence the URLs.
  indexSinglePage(parseVaultFile([
    "- intro https://example.com/a",
    "# Tasks and Ideas List",
    "- [ ] advertise on Reddit https://example.com/b",
    "\t- [ ] follow-up https://example.com/c",
    "- [ ] ship [[Release]] notes",
    "- [[Release]]",
    "\t- [[Release]] retro https://example.com/d",
  ].join("\n"), "Plugin.md", 1_700_000_000_000), g, DEFAULT_SETTINGS)
  const find = (prefix: string) =>
    g.getNodeAttributes(g.filterNodes((_k, n) => n.nodeType === "text" && n.searchKey.startsWith(prefix))[0])
  const parentKey = (prefix: string) => {
    const p = fileParent(g, find(prefix))
    return p ? getKey(p) : null
  }

  it("returns the enclosing header of a top-level bullet", () => {
    expect(parentKey("advertise")).toBe("plugin#tasks and ideas list")
  })

  it("returns the parent bullet of a nested bullet", () => {
    expect(parentKey("follow-up")).toBe(getKey(find("advertise")))
  })

  it("ignores pages the line links to", () => {
    expect(parentKey("ship")).toBe("plugin#tasks and ideas list")
  })

  it("returns the note for a bullet outside any header", () => {
    expect(parentKey("intro")).toBe("[[plugin]]")
  })

  it("returns a bullet the line also links", () => {
    expect(parentKey("[[release]] retro")).toBe("[[release]]")
  })
})

describe("outlineContext", () => {
  const g = new NotesGraph()
  indexSinglePage(parseVaultFile(
    "- [[UAE]]\n    - [[Rares Vlasceanu]] [analysis for requirements](https://example.com/a)",
    "2026-10-01.md", 1_700_000_000_000), g, DEFAULT_SETTINGS)
  const line = g.getNodeAttributes(g.filterNodes((_k, n) => n.nodeType === "text" && n.searchKey.includes("analysis"))[0])

  it("returns the outline parent for a line shown under an inline parent", () => {
    const ctx = outlineContext(g, line, g.getNodeAttributes("[[rares vlasceanu]]"))
    expect(ctx && getKey(ctx)).toBe("[[uae]]")
  })

  it("returns null for a line shown under its outline parent", () => {
    expect(outlineContext(g, line, g.getNodeAttributes("[[uae]]"))).toBeNull()
  })

  describe("line linking a heading", () => {
    const h = new NotesGraph()
    indexSinglePage(parseVaultFile(
      "- [[Rares Vlasceanu#2026]] [2026 goals](https://example.com/g)\n\n## 2026\n- shipped",
      "Rares Vlasceanu.md", 1_700_000_000_000), h, DEFAULT_SETTINGS)
    indexSinglePage(parseVaultFile(
      "- [[Rares Vlasceanu#2026]] review https://example.com/r",
      "2026-10-02.md", 1_700_000_000_000), h, DEFAULT_SETTINGS)
    const lineWith = (word: string) =>
      h.getNodeAttributes(h.filterNodes((_k, n) => n.nodeType === "text" && n.searchKey.includes(word))[0])

    it("returns null when the outline parent is the note the heading link already names", () => {
      expect(outlineContext(h, lineWith("goals"), h.getNodeAttributes("rares vlasceanu#2026"))).toBeNull()
    })

    it("returns the outline parent when it is another note", () => {
      const ctx = outlineContext(h, lineWith("review"), h.getNodeAttributes("rares vlasceanu#2026"))
      expect(ctx && getKey(ctx)).toBe("[[2026-10-02]]")
    })
  })
})
