import { describe, it, expect } from "bun:test"
import { describePatch, ensureHeading, parseLinkBullet, planOutlinePatches } from "../edit/note-patches.ts"
import { parseOutline } from "../edit/outline-edit.ts"

const plan = (outline: string, dropPatchOnlyRoots: boolean) => planOutlinePatches(parseOutline(outline).lines, { dropPatchOnlyRoots })
const empty = (name: string) => ({ name, aliases: [], headings: [], fields: [] })

describe("parseLinkBullet", () => {
  it("splits name, header and alias", () => {
    expect(parseLinkBullet("[[New Node|a]]")).toEqual({ name: "New Node", header: null, alias: "a", fields: [] })
  })

  it("reads trailing fields", () => {
    expect(parseLinkBullet("[[N#H]] (parent:: [[X]]) (is:: project)")).toEqual({
      name: "N",
      header: "H",
      alias: null,
      fields: [
        { key: "parent", value: "[[X]]" },
        { key: "is", value: "project" },
      ],
    })
  })

  it("rejects text around the link, invalid names, block refs and meta- fields", () => {
    expect(parseLinkBullet("met [[Bob]]")).toBeNull()
    expect(parseLinkBullet("[[a/b]]")).toBeNull()
    expect(parseLinkBullet("[[N#^blk]]")).toBeNull()
    expect(parseLinkBullet("[[N]] (meta-mdtree:: archive)")).toBeNull()
  })
})

describe("planOutlinePatches", () => {
  it("collects a patch per link bullet and keeps alias and header in the written links", () => {
    const outline = "- [[Note]]\n    - [[New Node|new-alias]]\n        - [[New Node#header]]\n            - [ ] task"
    const r = plan(outline, true)
    expect(r.lines).toEqual(parseOutline(outline).lines)
    expect(r.patches).toEqual([empty("Note"), { name: "New Node", aliases: ["new-alias"], headings: ["header"], fields: [] }])
  })

  it("drops a childless root that is only a patch, unless asked to keep it", () => {
    const dropped = plan("- [[Note]] (is:: project)", true)
    expect(dropped.lines).toEqual([])
    expect(dropped.patches).toEqual([{ ...empty("Note"), fields: [{ key: "is", value: "project" }] }])
    expect(plan("- [[Note]] (is:: project)", false).lines).toEqual([{ depth: 0, marker: "- ", text: "[[Note]]" }])
  })

  it("keeps a root with children and strips its fields", () => {
    const r = plan("- [[N]] (parent:: [[X]])\n    - child", true)
    expect(r.lines).toEqual([
      { depth: 0, marker: "- ", text: "[[N]]" },
      { depth: 1, marker: "- ", text: "child" },
    ])
    expect(r.patches[0].fields).toEqual([{ key: "parent", value: "[[X]]" }])
  })

  it("treats an aliases field as an alias and merges names case-insensitively", () => {
    const r = plan("- [[Note]] (aliases:: b)\n- [[note|c]]", true)
    expect(r.patches).toEqual([{ name: "Note", aliases: ["b", "c"], headings: [], fields: [] }])
  })
})

describe("ensureHeading", () => {
  it("appends a level-2 heading as a new paragraph", () => {
    expect(ensureHeading("x\n", "Plan")).toBe("x\n\n## Plan\n")
  })

  it("keeps a note that already has the heading at any level", () => {
    expect(ensureHeading("### plan\nbody\n", "Plan")).toBe("### plan\nbody\n")
  })
})

describe("describePatch", () => {
  it("lists creation, aliases, headings and fields in order", () => {
    const p = { name: "N", aliases: ["a"], headings: ["h"], fields: [{ key: "is", value: "x" }] }
    expect(describePatch(p, false)).toEqual(['Creates note "N"', 'Adds alias "a" to N', 'Adds heading "h" to N', "Sets is: x on N"])
    expect(describePatch(p, true)[0]).toBe('Adds alias "a" to N')
  })
})
