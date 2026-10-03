import { describe, it, expect } from "bun:test"
import { flattenIndex, defaultVisibility } from "../search/flatten.ts"
import { parseQuery } from "../search/query.ts"
import type { ResultNode } from "../search/search.ts"
import type { ParsedNode } from "../graph/types.ts"

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
    expect(defaultVisibility(flat, Infinity)).toEqual([true, true, false, true])
  })
})
