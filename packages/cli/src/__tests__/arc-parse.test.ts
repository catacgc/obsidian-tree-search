import { describe, it, expect } from "bun:test"
import { parseArcSidebar, renderSpaces } from "../../../../plugins/arc/run.ts"

/**
 * Minimal StorableSidebar.json-shaped fixture:
 * - a stale container (1 space, 1 item) that must be ignored in favour of the
 *   live container (more item objects),
 * - the live "Work" space with a pinned tree: Folder A > Nested Link, plus a
 *   top-level Top Link,
 * - an unpinned/open tab that must be excluded.
 */
const fixture = {
  sidebar: {
    containers: [
      { global: {} },
      {
        spaces: ["stale-id", { id: "stale-id", title: "Stale", containerIDs: ["pinned", "SP"] }],
        items: ["SP", { id: "SP", childrenIds: [], data: {} }],
      },
      {
        spaces: [
          "s1",
          { id: "s1", title: "Work", containerIDs: ["unpinned", "U1", "pinned", "P1"] },
        ],
        items: [
          "P1", { id: "P1", childrenIds: ["F1", "Ltop"], data: {} },
          "F1", { id: "F1", title: "Folder A", data: { list: {} }, childrenIds: ["L1"] },
          "L1", {
            id: "L1", title: null, childrenIds: [],
            data: { tab: { savedTitle: "Nested Link", savedURL: "https://example.com/nested" } },
          },
          "Ltop", {
            id: "Ltop",
            data: { tab: { savedTitle: "Top Link", savedURL: "https://example.com/top" } },
          },
          "U1", { id: "U1", childrenIds: ["UT1"], data: {} },
          "UT1", {
            id: "UT1",
            data: { tab: { savedTitle: "Open Tab", savedURL: "https://example.com/open" } },
          },
        ],
      },
    ],
  },
}

describe("parseArcSidebar", () => {
  it("selects the live container and parses the pinned tree", () => {
    const spaces = parseArcSidebar(fixture)
    expect(spaces).toHaveLength(1)
    expect(spaces[0].title).toBe("Work")

    const tree = spaces[0].tree
    expect(tree).toHaveLength(2)

    expect(tree[0]).toEqual({
      type: "folder",
      title: "Folder A",
      children: [{ type: "link", title: "Nested Link", url: "https://example.com/nested" }],
    })
    expect(tree[1]).toEqual({
      type: "link",
      title: "Top Link",
      url: "https://example.com/top",
    })
  })

  it("excludes unpinned / open tabs", () => {
    const spaces = parseArcSidebar(fixture)
    expect(JSON.stringify(spaces)).not.toContain("example.com/open")
  })

  it("filters spaces by title (case-insensitive) when a filter is given", () => {
    expect(parseArcSidebar(fixture, new Set(["work"]))).toHaveLength(1)
    expect(parseArcSidebar(fixture, new Set(["nonexistent"]))).toHaveLength(0)
  })

  it("returns nothing for malformed input", () => {
    expect(parseArcSidebar({})).toEqual([])
    expect(parseArcSidebar(null)).toEqual([])
  })
})

describe("renderSpaces", () => {
  it("renders a header per space and an indented link/folder tree", () => {
    const md = renderSpaces(parseArcSidebar(fixture))
    expect(md).toContain("## Work")
    expect(md).toContain("- [[Folder A]]")
    expect(md).toContain("  - [Nested Link](https://example.com/nested)")
    expect(md).toContain("- [Top Link](https://example.com/top)")
    expect(md).not.toContain("Open Tab")
  })

  it("wraps URLs with unbalanced parens or spaces in angle brackets", () => {
    const json = {
      sidebar: {
        containers: [
          {
            spaces: ["s", { id: "s", title: "S", containerIDs: ["pinned", "P"] }],
            items: [
              "P", { id: "P", childrenIds: ["a", "b"], data: {} },
              "a", { id: "a", data: { tab: { savedTitle: "Jira", savedURL: "https://x/?jql=(a AND (b))" } } },
              "b", { id: "b", data: { tab: { savedTitle: "Bad", savedURL: "https://x/?q=broken)" } } },
            ],
          },
        ],
      },
    }
    const md = renderSpaces(parseArcSidebar(json))
    // balanced parens + a space -> angle-wrapped
    expect(md).toContain("- [Jira](<https://x/?jql=(a AND (b))>)")
    // unbalanced parens -> angle-wrapped
    expect(md).toContain("- [Bad](<https://x/?q=broken)>)")
  })
})
