import { describe, it, expect } from "bun:test"
import { lineNode, lineMatches, blockMisses, filterOutline } from "../search/line-node.ts"
import { parseQuery } from "../search/query.ts"
import type { ResultNode } from "../search/search.ts"
import type { ParsedNode } from "../graph/types.ts"

describe("lineNode", () => {
  it("makes a task text node with its tags", () => {
    const node = lineNode("- [ ] call [[Bob]] #x", "daily/2026-10-15.md", 3, false)
    expect(node).toMatchObject({ nodeType: "text", isTask: true, isCompleted: false, tags: ["#x"] })
    expect(node).not.toHaveProperty("nested")
  })

  it("makes a page node for a link-only line, located at path and line", () => {
    const node = lineNode("    - [[Proj]]", "a/b.md", 7, true)
    expect(node).toMatchObject({ nodeType: "page", page: "Proj" })
    expect(node?.location.path).toBe("a/b.md")
    expect(node?.location.position.start.line).toBe(7)
    expect(node).not.toHaveProperty("nested")
  })

  it("makes a header node for a heading", () => {
    expect(lineNode("## Plans", "Note.md", 2, false)).toMatchObject({ nodeType: "header", header: "Plans", page: "Note" })
  })

  it("returns null for a plain prose bullet", () => {
    expect(lineNode("- just prose", "Note.md", 0, false)).toBeNull()
  })

  it("marks a text node nested when asked", () => {
    expect(lineNode("        - see #tag", "Note.md", 4, true)).toMatchObject({ nodeType: "text", nested: true })
  })
})

describe("lineMatches", () => {
  const node = lineNode("- [ ] call #x", "Note.md", 0, false)

  it("matches anything, null included, with no stages", () => {
    expect(lineMatches(null, [])).toBe(true)
  })

  it("never matches a null node with stages", () => {
    expect(lineMatches(null, parseQuery("call"))).toBe(false)
  })

  it("requires every stage to match", () => {
    expect(lineMatches(node, [...parseQuery("call"), ...parseQuery("#x")])).toBe(true)
    expect(lineMatches(node, [...parseQuery("call"), ...parseQuery("nope")])).toBe(false)
  })
})

describe("blockMisses", () => {
  // parent foo / prose child / sibling / sibling's bar kid
  const lines = [
    { depth: 0, node: lineNode("- parent foo #t", "N.md", 0, false) },
    { depth: 1, node: null },
    { depth: 0, node: lineNode("- sib #t", "N.md", 2, false) },
    { depth: 1, node: lineNode("- kid bar #t", "N.md", 3, true) },
  ]
  const none = { above: [false], below: [false] }

  it("has no misses without stages", () => {
    expect(blockMisses(lines, [], { above: [], below: [] })).toEqual([false, false, false, false])
  })

  it("keeps a match and the lines under it in its ancestor chain", () => {
    expect(blockMisses(lines, parseQuery("foo"), none)).toEqual([false, false, true, true])
  })

  it("keeps the ancestors of a match", () => {
    expect(blockMisses(lines, parseQuery("bar"), none)).toEqual([true, true, false, false])
  })

  it("misses a line some stage doesn't keep", () => {
    const stages = [...parseQuery("foo"), ...parseQuery("bar")]
    expect(blockMisses(lines, stages, { above: [false, false], below: [false, false] })).toEqual([true, true, true, true])
  })

  it("keeps every line when the edited row's ancestors match", () => {
    expect(blockMisses(lines, parseQuery("zzz"), { above: [true], below: [false] })).toEqual([false, false, false, false])
  })

  it("keeps only the first line when the edited row's descendants match", () => {
    expect(blockMisses(lines, parseQuery("zzz"), { above: [false], below: [true] })).toEqual([false, true, true, true])
  })
})

describe("filterOutline", () => {
  const leaf = (key: string, children: ResultNode[] = []): ResultNode => ({
    node: { nodeType: "text", searchKey: key, tags: [], isTask: false, isCompleted: false, parsedTokens: [] } as unknown as ParsedNode,
    children,
    parents: [],
  })
  const keys = (nodes: ResultNode[]): unknown[] =>
    nodes.map(n => (n.children.length ? [n.node.searchKey, n.miss ?? false, keys(n.children)] : [n.node.searchKey, n.miss ?? false]))
  const tree = [leaf("alpha foo", [leaf("beta")]), leaf("gamma", [leaf("delta foo bar")]), leaf("eps bar")]
  const stages = [...parseQuery("foo"), ...parseQuery("bar")]

  it("returns the nodes unchanged with no stages", () => {
    expect(filterOutline(tree, [], () => true)).toBe(tree)
  })

  it("narrows like filterDown when nothing is pinned", () => {
    expect(keys(filterOutline(tree, stages, () => false))).toEqual([["gamma", false, [["delta foo bar", false]]]])
  })

  it("keeps a pinned node that would be dropped, with its whole subtree, as a miss", () => {
    const pinned = (n: ParsedNode) => n.searchKey === "beta"
    expect(keys(filterOutline(tree, stages, pinned))).toEqual([
      ["alpha foo", false, [["beta", true]]],
      ["gamma", false, [["delta foo bar", false]]],
    ])
    expect(keys(filterOutline(tree, stages, n => n.searchKey === "alpha foo"))[0]).toEqual(["alpha foo", true, [["beta", false]]])
  })

  it("keeps a miss from an earlier stage when a later one matches", () => {
    const pinned = (n: ParsedNode) => n.searchKey === "eps bar"
    expect(keys(filterOutline(tree, stages, pinned))).toContainEqual(["eps bar", true])
  })

  it("does not mutate its input", () => {
    filterOutline(tree, stages, () => true)
    expect(keys(tree)).toEqual([
      ["alpha foo", false, [["beta", false]]],
      ["gamma", false, [["delta foo bar", false]]],
      ["eps bar", false],
    ])
  })
})
