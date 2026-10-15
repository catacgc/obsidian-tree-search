import { describe, it, expect } from "bun:test"
import type { ParsedNode, TextNode, PageNode } from "../graph/types.ts"
import type { ResultNode } from "../search/search.ts"
import { archiveToggle, partitionArchived } from "../search/archive.ts"

// ── Test helpers ──────────────────────────────────────────────────────────────

function textNode(key: string, archived = false, inherited = false): TextNode {
  return {
    nodeType: "text",
    searchKey: key,
    parsedTokens: [],
    tags: [],
    isTask: false,
    isCompleted: false,
    location: { path: "test.md", position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } } },
    boost: 0,
    ageDays: 0,
    ...(archived ? { archived: true } : {}),
    ...(inherited ? { archiveInherited: true } : {}),
  }
}

function pageNode(key: string): PageNode {
  return {
    nodeType: "page",
    searchKey: key,
    isReference: false,
    page: key,
    aliases: [],
    tags: [],
    location: { path: "test.md", position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } } },
    boost: 0,
    ageDays: 0,
  }
}

function rn(node: ParsedNode, children: ResultNode[] = []): ResultNode {
  return { node, children, parents: [] }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("archiveToggle", () => {
  it("offers Archive for a row that isn't archived", () => {
    expect(archiveToggle(textNode("item"))).toBe("archive")
  })

  it("offers Unarchive for a row carrying the tag itself", () => {
    expect(archiveToggle(textNode("item", true))).toBe("unarchive")
  })

  it("offers nothing for a row archived only through a parent", () => {
    expect(archiveToggle(textNode("item", true, true))).toBeNull()
  })
})

describe("partitionArchived", () => {
  it("returns all visible when no archived items", () => {
    const results = [
      rn(textNode("a"), [rn(textNode("b"))]),
      rn(textNode("c")),
    ]
    const { visible, archivedCount } = partitionArchived(results)
    expect(visible).toHaveLength(2)
    expect(archivedCount).toBe(0)
  })

  it("removes root-level archived item with subtree count", () => {
    const results = [
      rn(textNode("active")),
      rn(textNode("archived", true), [rn(textNode("child1")), rn(textNode("child2"))]),
    ]
    const { visible, archivedCount } = partitionArchived(results)
    expect(visible).toHaveLength(1)
    expect(visible[0].node.searchKey).toBe("active")
    expect(archivedCount).toBe(3) // archived root + 2 children
  })

  it("prunes nested archived subtree but keeps parent", () => {
    const results = [
      rn(textNode("parent"), [
        rn(textNode("child1")),
        rn(textNode("child2-archived", true), [rn(textNode("grandchild"))]),
        rn(textNode("child3")),
      ]),
    ]
    const { visible, archivedCount } = partitionArchived(results)
    expect(visible).toHaveLength(1)
    expect(visible[0].node.searchKey).toBe("parent")
    expect(visible[0].children).toHaveLength(2)
    expect(visible[0].children[0].node.searchKey).toBe("child1")
    expect(visible[0].children[1].node.searchKey).toBe("child3")
    expect(archivedCount).toBe(2) // child2-archived + grandchild
  })

  it("handles multiple archived at different levels", () => {
    const results = [
      rn(textNode("root1"), [
        rn(textNode("archived-branch", true), [rn(textNode("deep"))]),
        rn(textNode("active-branch")),
      ]),
      rn(textNode("root2-archived", true)),
    ]
    const { visible, archivedCount } = partitionArchived(results)
    expect(visible).toHaveLength(1)
    expect(visible[0].node.searchKey).toBe("root1")
    expect(visible[0].children).toHaveLength(1)
    expect(visible[0].children[0].node.searchKey).toBe("active-branch")
    expect(archivedCount).toBe(3) // archived-branch + deep + root2-archived
  })

  it("returns empty visible when all items archived", () => {
    const results = [
      rn(textNode("archived1", true)),
      rn(textNode("archived2", true)),
    ]
    const { visible, archivedCount } = partitionArchived(results)
    expect(visible).toHaveLength(0)
    expect(archivedCount).toBe(2)
  })

  it("handles empty input", () => {
    const { visible, archivedCount } = partitionArchived([])
    expect(visible).toHaveLength(0)
    expect(archivedCount).toBe(0)
  })

  it("path-contextually hides non-archived descendants of an archived ancestor", () => {
    // Only the ancestor is intrinsically archived; the child is not, yet it is
    // effectively archived because it sits under one → hidden by default.
    const results = [
      rn(textNode("archived-parent", true), [
        rn(textNode("plain-child"), [rn(textNode("plain-grandchild"))]),
      ]),
    ]
    const { visible, archivedCount } = partitionArchived(results)
    expect(visible).toHaveLength(0)
    expect(archivedCount).toBe(3) // parent + child + grandchild
  })
})

describe("partitionArchived — reveal", () => {
  it("keeps archived items and stamps effectiveArchived when reveal=true", () => {
    const results = [
      rn(textNode("active")),
      rn(textNode("archived", true), [rn(textNode("child"))]),
    ]
    const { visible, archivedCount } = partitionArchived(results, true)
    expect(archivedCount).toBe(0)
    expect(visible).toHaveLength(2)
    const [active, archived] = visible
    expect(active.effectiveArchived).toBe(false)
    expect(archived.effectiveArchived).toBe(true)
    // Propagated path-contextually to the non-archived child.
    expect(archived.children[0].effectiveArchived).toBe(true)
  })

  it("does not mark unrelated siblings as archived when revealing", () => {
    const results = [
      rn(textNode("parent"), [
        rn(textNode("archived-branch", true), [rn(textNode("deep"))]),
        rn(textNode("active-branch")),
      ]),
    ]
    const { visible } = partitionArchived(results, true)
    const parent = visible[0]
    expect(parent.effectiveArchived).toBe(false)
    const archivedBranch = parent.children.find(c => c.node.searchKey === "archived-branch")!
    const activeBranch = parent.children.find(c => c.node.searchKey === "active-branch")!
    expect(archivedBranch.effectiveArchived).toBe(true)
    expect(archivedBranch.children[0].effectiveArchived).toBe(true)
    expect(activeBranch.effectiveArchived).toBe(false)
  })
})
