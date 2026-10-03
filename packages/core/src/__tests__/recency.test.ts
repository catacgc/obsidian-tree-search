import { describe, it, expect } from "bun:test"
import { pruneToRecency } from "../search/recency.ts"
import { UNDATED_AGE } from "../graph/boost.ts"
import type { ResultNode } from "../search/search.ts"
import type { Location, TextNode } from "../graph/types.ts"

const baseLocation: Location = { path: "note.md", position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } } }

function node(searchKey: string, ageDays: number, children: ResultNode[] = []): ResultNode {
  const parsed: TextNode = {
    nodeType: "text", searchKey, location: baseLocation, boost: 0, ageDays,
    parsedTokens: [{ tokenType: "text", text: searchKey, decoration: "none" }],
    isTask: false, isCompleted: false, tags: [],
  }
  return { node: parsed, children, parents: [] }
}

const shape = (rs: ResultNode[]): unknown[] =>
  rs.map(r => r.children.length ? { [r.node.searchKey]: shape(r.children) } : r.node.searchKey)

describe("pruneToRecency", () => {
  it("keeps an in-window node, its ancestors and its undated children", () => {
    const tree = [node("parent", 20, [node("child", 5, [node("context", UNDATED_AGE)])])]
    expect(shape(pruneToRecency(tree, 7))).toEqual([{ parent: [{ child: ["context"] }] }])
  })

  it("drops a dated child outside the window", () => {
    const tree = [node("parent", 20, [node("child", 5, [node("old", 10)])])]
    expect(shape(pruneToRecency(tree, 7))).toEqual([{ parent: ["child"] }])
  })

  it("keeps an out-of-window node when something below it is in the window", () => {
    const tree = [node("child", 5, [node("old", 10, [node("recent", 2)])])]
    expect(shape(pruneToRecency(tree, 7))).toEqual([{ child: [{ old: ["recent"] }] }])
  })

  it("keeps undated context only one level below an in-window node", () => {
    const tree = [node("child", 5, [node("context", UNDATED_AGE, [node("deeper", UNDATED_AGE)])])]
    expect(shape(pruneToRecency(tree, 7))).toEqual([{ child: ["context"] }])
  })

  it("drops whole trees with no in-window node, including undated ones", () => {
    const tree = [node("page", UNDATED_AGE, [node("old", 30)]), node("recent", 1)]
    expect(shape(pruneToRecency(tree, 7))).toEqual(["recent"])
  })

  it("does not mutate the input", () => {
    const tree = [node("parent", 20, [node("old", 10), node("child", 5)])]
    pruneToRecency(tree, 7)
    expect(tree[0].children).toHaveLength(2)
  })
})
