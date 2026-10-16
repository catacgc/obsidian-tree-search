import { describe, it, expect } from "bun:test"
import { flattenIndex, defaultVisibility, compactChildren, blockFooters } from "../search/flatten.ts"
import { parseQuery } from "../search/query.ts"
import type { ResultNode } from "../search/search.ts"
import type { ParsedNode } from "../graph/types.ts"
import { calculateBoost, UNDATED_AGE } from "../graph/boost.ts"

const baseLocation = { path: "note.md", position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } } } as any

function text(searchKey: string): ParsedNode {
  return {
    nodeType: "text", searchKey, location: baseLocation, boost: 0, ageDays: 0,
    parsedTokens: [{ tokenType: "text", text: searchKey, decoration: "none" }],
    isTask: false, isCompleted: false, tags: [],
  } as ParsedNode
}

function node(searchKey: string, children: ResultNode[] = []): ResultNode {
  return { node: text(searchKey), children, parents: [] }
}

describe("flattenIndex matched flag", () => {
  const tree: ResultNode[] = [node("foo hit", [node("unrelated context")])]

  it("marks a hit matched and its non-matching context descendant unmatched", () => {
    const flat = flattenIndex(tree, Infinity, parseQuery("foo", "."))
    const hit = flat.find(n => n.node.searchKey === "foo hit")!
    const ctx = flat.find(n => n.node.searchKey === "unrelated context")!
    expect(hit.matched).toBe(true)
    expect(ctx.matched).toBe(false)
  })

  it("marks every row matched when there is no query", () => {
    const flat = flattenIndex(tree, Infinity)
    expect(flat.every(n => n.matched)).toBe(true)
  })
})

describe("flattenIndex greyed-out subtrees", () => {
  const visibleKeys = (rows: { node: ParsedNode; visible: boolean }[]) =>
    rows.filter(r => r.visible).map(r => r.node.searchKey)

  it("shows a dimmed subtree's root but collapses its descendants at any expand level", () => {
    const tree = [node("foo hit", [node("context", [node("deep context")]), node("foo child")])]
    const flat = flattenIndex(tree, Infinity, parseQuery("foo", "."))
    expect(visibleKeys(flat)).toEqual(["foo hit", "context", "foo child"])
  })

  it("keeps dimmed ancestors that lead to a hit expanded", () => {
    const tree = [node("context", [node("more context", [node("foo hit")])])]
    const flat = flattenIndex(tree, Infinity, parseQuery("foo", "."))
    expect(visibleKeys(flat)).toEqual(["context", "more context", "foo hit"])
  })

  it("collapses an archived subtree even when its rows match", () => {
    const archived = (key: string, children: ResultNode[] = []): ResultNode =>
      ({ ...node(key, children), effectiveArchived: true })
    const tree = [node("foo page", [archived("foo old", [archived("foo older")])])]
    const flat = flattenIndex(tree, Infinity, parseQuery("foo", "."))
    expect(visibleKeys(flat)).toEqual(["foo page", "foo old"])
  })

  it("still honours the expand level above a greyed-out subtree", () => {
    const tree = [node("foo hit", [node("context", [node("deep context")])])]
    expect(visibleKeys(flattenIndex(tree, 0, parseQuery("foo", ".")))).toEqual(["foo hit"])
  })

  it("recomputes the same default when the expand level changes", () => {
    const tree = [node("foo hit", [node("context", [node("deep context")]), node("foo child")])]
    const flat = flattenIndex(tree, 0, parseQuery("foo", "."))
    expect(defaultVisibility(flat, Infinity).map(v => v.visible)).toEqual([true, true, false, true])
  })
})

describe("list compaction", () => {
  it("compactChildren keeps all of a short list, else the first 3 plus every bright child", () => {
    expect(compactChildren([false, false, false, false, true])).toEqual([true, true, true, false, true])
    expect(compactChildren([false, false, false])).toEqual([true, true, true])
  })

  it("a matched list shows its first 3 children at level 0 and footers the compacted rest", () => {
    const list: ResultNode = {
      node: { ...text("foo list"), list: true } as ParsedNode,
      children: ["c1", "c2", "c3", "c4", "c5"].map(k => node(k)),
      parents: [],
    }
    const flat = flattenIndex([list], 0, parseQuery("foo", "."))
    expect(defaultVisibility(flat, 0)).toEqual([
      { visible: true, compacted: false },
      { visible: true, compacted: false },
      { visible: true, compacted: false },
      { visible: true, compacted: false },
      { visible: false, compacted: true },
      { visible: false, compacted: true },
    ])
    expect([...blockFooters(flat)]).toEqual([[flat[3].index, [{ listIndex: flat[0].index, hidden: 2, indent: 1 }]]])
  })
})

describe("flattenIndex sibling order", () => {
  // Real boosts: type first, then emoji and recency.
  const line = (key: string, ageDays: number, task?: "open" | "done"): ResultNode => ({
    node: {
      ...text(key), ageDays, boost: calculateBoost("text", key, ageDays),
      isTask: task !== undefined, isCompleted: task === "done",
    } as ParsedNode,
    children: [], parents: [],
  })
  const page = (key: string): ResultNode => ({
    node: { nodeType: "page", searchKey: key, location: baseLocation, boost: calculateBoost("page", key, UNDATED_AGE),
      ageDays: UNDATED_AGE, isReference: false, page: key, aliases: [], tags: [] } as ParsedNode,
    children: [], parents: [],
  })

  it("keeps pages above lines, then puts open tasks first among lines, oldest first, undated last", () => {
    const parent = node("parent", [
      line("note new", 1), line("due tomorrow", -1, "open"), line("🔥 pinned note", 3), line("done", 0, "done"),
      page("child page"), line("overdue", 5, "open"), line("undated task", UNDATED_AGE, "open"), line("today", 0, "open"),
    ])
    expect(flattenIndex([parent], Infinity).map(r => r.node.searchKey)).toEqual([
      "parent", "child page", "overdue", "today", "due tomorrow", "undated task", "🔥 pinned note", "done", "note new",
    ])
  })
})

describe("flattenIndex options", () => {
  const at = (key: string, path: string, line: number, children: ResultNode[] = []): ResultNode => ({
    node: { ...text(key), location: { path, position: { start: { line, ch: 0 }, end: { line, ch: 0 } } } } as ParsedNode,
    children,
    parents: [],
  })

  it("fileOrder sorts siblings by path, then line", () => {
    const tree = [at("b2", "b.md", 2), at("a9", "a.md", 9), at("b1", "b.md", 1)]
    expect(flattenIndex(tree, 0, [], { fileOrder: true }).map(r => r.node.searchKey)).toEqual(["a9", "b1", "b2"])
  })

  it("expandAll shows every row, none compacted", () => {
    const list: ResultNode = {
      ...at("list", "a.md", 0, ["c1", "c2", "c3", "c4", "c5"].map(k => at(k, "a.md", 1, [at(`${k} kid`, "a.md", 2)]))),
      node: { ...text("list"), list: true } as ParsedNode,
    }
    const rows = flattenIndex([list], 0, [], { expandAll: true })
    expect(rows.every(r => r.visible && !r.compacted)).toBe(true)
  })

  it("carries a ResultNode's miss onto its row", () => {
    const rows = flattenIndex([{ ...at("x", "a.md", 0), miss: true }, at("y", "a.md", 1)], 0, [], { fileOrder: true })
    expect(rows.map(r => r.miss)).toEqual([true, undefined])
  })
})
