import { describe, it, expect } from "bun:test"
import type { ParsedNode, TextNode, PageNode } from "../graph/types.ts"
import type { ResultNode } from "../search/search.ts"
import { UNDATED_AGE } from "../graph/boost.ts"
import { parseQuery } from "../search/query.ts"
import { buildTimeline, fileParent } from "../search/timeline.ts"
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
  it("emits last-stage hits and their descendants, newest first, with matched-ancestor breadcrumbs", () => {
    const ibm = pageNode("IBM")
    const spark = textNode("Spark", 10)
    const arch = textNode("Spark architecture", 2)
    // A sub-item of a hit that does not itself match (e.g. `[[Azure to AWS
    // migration]]` under `CAN2 migration` for query `can2`) is shown, like the tree.
    const sub = textNode("unrelated", 1)
    const tree = [rn(ibm, [rn(spark, [rn(arch), rn(sub)])]), rn(textNode("elsewhere", 0))]

    const items = buildTimeline(tree, parseQuery("ibm . spark", "."))

    expect(keys(items)).toEqual(["unrelated", "Spark architecture", "Spark"])
    expect(items[0].breadcrumb).toEqual([ibm, spark])
    expect(items[1].breadcrumb).toEqual([ibm, spark])
    expect(items[2].breadcrumb).toEqual([ibm])
  })

  it("pins emoji hits on top and lets them bypass the recency window", () => {
    const tree = [
      rn(textNode("spark old", 400)),
      rn(textNode("spark 🚀 idea", UNDATED_AGE)),
      rn(textNode("spark new", 3)),
    ]
    const stages = parseQuery("spark", ".")

    const all = buildTimeline(tree, stages)
    expect(keys(all)).toEqual(["spark 🚀 idea", "spark new", "spark old"])
    expect(all[0].pinned).toBe(true)

    expect(keys(buildTimeline(tree, stages, 7))).toEqual(["spark 🚀 idea", "spark new"])
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
})
