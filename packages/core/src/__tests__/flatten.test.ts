import { describe, it, expect } from "bun:test"
import { flattenIndex } from "../search/flatten.ts"
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
