import { describe, it, expect } from "bun:test"
import {
  parseOutline,
  renderOutline,
  findOutlineEnd,
  findSubtreeEnd,
  findLinkBullet,
  appendUnderLinkBullet,
  appendOutline,
  firstAppendedLine,
  appendContent,
  splitEditableLine,
  lineHasIdentity,
  replaceLineText,
  cutSubtree,
  pasteUnderLinkBullet,
  pasteAtOutlineEnd,
  StaleLineError,
} from "../edit/outline-edit.ts"
import { NotesGraph } from "../graph/graph.ts"
import { indexSinglePage, DEFAULT_SETTINGS } from "../graph/indexer.ts"
import { parseVaultFile } from "../parser/vault-file.ts"
import type { ParsedNode } from "../graph/types.ts"

const outline = (text: string) => parseOutline(text).lines

const EXAMPLE_1 = "- [[Standup]]\n    - [[Alice]]\nNotes from the day…\n"

describe("appendUnderLinkBullet", () => {
  it("EDITOR.md §4.3 example 1: adds a [[P]] bullet after the leading outline, before prose", () => {
    expect(appendUnderLinkBullet(EXAMPLE_1, "Project X", outline("- [[Related note]] https://example.com/spec"))).toBe(
      "- [[Standup]]\n    - [[Alice]]\n- [[Project X]]\n    - [[Related note]] https://example.com/spec\nNotes from the day…\n",
    )
  })

  it("EDITOR.md §4.3 example 2: appends under the existing [[P]] bullet, keeping relative indents", () => {
    const first = appendUnderLinkBullet(EXAMPLE_1, "Project X", outline("- [[Related note]] https://example.com/spec"))
    const second = appendUnderLinkBullet(
      first,
      "Project X",
      outline("- [[New child]] kickoff\n    - ![[whiteboard.png|Whiteboard]]"),
    )
    expect(second).toBe(
      "- [[Standup]]\n    - [[Alice]]\n- [[Project X]]\n    - [[Related note]] https://example.com/spec\n" +
        "    - [[New child]] kickoff\n        - ![[whiteboard.png|Whiteboard]]\nNotes from the day…\n",
    )
  })

  it("never touches frontmatter; bullets go after it and before prose", () => {
    expect(appendUnderLinkBullet("---\ntitle: x\n---\nSome prose\n", "P", outline("- #t x"))).toBe(
      "---\ntitle: x\n---\n- [[P]]\n    - #t x\nSome prose\n",
    )
  })

  it("preserves CRLF line endings", () => {
    expect(appendUnderLinkBullet("- [[A]]\r\nprose\r\n", "P", outline("- #t x"))).toBe(
      "- [[A]]\r\n- [[P]]\r\n    - #t x\r\nprose\r\n",
    )
  })

  it("inserts before prose when the note starts with prose", () => {
    expect(appendUnderLinkBullet("\nJust prose\n- [[late]]\n", "P", outline("- #t x"))).toBe(
      "\n- [[P]]\n    - #t x\nJust prose\n- [[late]]\n",
    )
  })

  it("appends after an existing aliased link bullet's subtree, keeping trailing blank lines after", () => {
    const content = "- [[project x|PX]]\n    - [[a]]\n\n    prose child\n\n- [[Other]]\n"
    expect(findLinkBullet(content, "Project X")).toBe(0)
    expect(appendUnderLinkBullet(content, "Project X", outline("- #t x\n    - #t y"))).toBe(
      "- [[project x|PX]]\n    - [[a]]\n\n    prose child\n    - #t x\n        - #t y\n\n- [[Other]]\n",
    )
  })

  it("ignores a heading before the outline and a link bullet with extra text", () => {
    const content = "# H\n- [[P]] extra\nprose\n"
    expect(findLinkBullet(content, "P")).toBeNull()
    expect(appendUnderLinkBullet(content, "P", outline("- #t x"))).toBe(
      "# H\n- [[P]] extra\n- [[P]]\n    - #t x\nprose\n",
    )
  })

  it("does not match a link bullet after the outline break", () => {
    const content = "- [[A]]\nprose\n- [[P]]\n"
    expect(findLinkBullet(content, "P")).toBeNull()
    expect(appendUnderLinkBullet(content, "P", outline("- #t x"))).toBe("- [[A]]\n- [[P]]\n    - #t x\nprose\n- [[P]]\n")
  })

  it("treats a multi-line %% comment as neutral", () => {
    const content = "%% start\nnot a break\n%%\n- [[A]]\nprose\n"
    expect(findOutlineEnd(content)).toBe(4)
    expect(appendUnderLinkBullet(content, "P", outline("- #t x"))).toBe(
      "%% start\nnot a break\n%%\n- [[A]]\n- [[P]]\n    - #t x\nprose\n",
    )
  })

  it("writes into an empty file", () => {
    expect(appendUnderLinkBullet("", "P", outline("- x"))).toBe("- [[P]]\n    - x\n")
  })

  it("inserts at end of file (before its trailing newline) when there is no outline and no break", () => {
    expect(appendUnderLinkBullet("# H\n", "P", outline("- #t x"))).toBe("# H\n- [[P]]\n    - #t x\n")
  })

  it("round-trips: the new line is indexed as a child of the parent page", () => {
    const content = appendUnderLinkBullet(EXAMPLE_1, "Project X", outline("- [[Related note]] https://example.com/spec"))
    const graph = new NotesGraph()
    indexSinglePage(parseVaultFile(content, "2026-09-30.md", 1_700_000_000_000), graph, DEFAULT_SETTINGS)
    const children = graph
      .outboundEdgeEntries("[[project x]]")
      .map(e => graph.getNodeAttributes(e.target))
      .filter(n => n.location.path === "2026-09-30.md" && n.location.position.start.line === 3)
    expect(children).toHaveLength(1)
    expect(children[0].nodeType).toBe("text")
  })

  it("indents with tabs in a tab-indented note, so the new line nests under the parent bullet", () => {
    const content = appendUnderLinkBullet("- [[Coworker]]\n\t- [[A]]\n\t\t- [[B]]\n- [[Other]]\n", "Coworker", outline("- [[X]] hi\n    - [[Y]]"))
    expect(content).toBe("- [[Coworker]]\n\t- [[A]]\n\t\t- [[B]]\n\t- [[X]] hi\n\t\t- [[Y]]\n- [[Other]]\n")
    const graph = new NotesGraph()
    indexSinglePage(parseVaultFile(content, "w.md", 1_700_000_000_000), graph, DEFAULT_SETTINGS)
    const lines = graph
      .outboundEdgeEntries("[[coworker]]")
      .map(e => graph.getNodeAttributes(e.target))
      .filter(n => n.location.path === "w.md")
      .map(n => n.location.position.start.line)
    expect(lines).toContain(3)
  })
})

describe("appendOutline", () => {
  it("merges a link-only root's children under the note's existing [[X]] bullet", () => {
    expect(appendOutline(EXAMPLE_1, outline("- [[Standup]]\n    - [[Bob]]"))).toBe(
      "- [[Standup]]\n    - [[Alice]]\n    - [[Bob]]\nNotes from the day…\n",
    )
  })

  it("inserts a root that is not link-only, with its subtree, at the outline end", () => {
    expect(appendOutline("- [[A]]\nprose\n", outline("- [[X]] note\n    - child"))).toBe("- [[A]]\n- [[X]] note\n    - child\nprose\n")
  })

  it("writes a link root as typed (alias kept) when the note has no such bullet", () => {
    expect(appendOutline("", outline("- [[P|Alias]]\n    - x"))).toBe("- [[P|Alias]]\n    - x\n")
  })

  it("handles several roots in order", () => {
    expect(appendOutline("- [[A]]\n", outline("- [[A]]\n    - a1\n- b"))).toBe("- [[A]]\n    - a1\n- b\n")
  })

  it("keeps tab indentation in a tab-indented note", () => {
    expect(appendOutline("- [[P]]\n\t- a\n", outline("- [[P]]\n    - b"))).toBe("- [[P]]\n\t- a\n\t- b\n")
  })
})

describe("firstAppendedLine", () => {
  const appendAndLocate = (before: string, typed: string) => firstAppendedLine(before, appendOutline(before, outline(typed)))

  it("points at the child merged into an existing [[P]] bullet's subtree", () => {
    expect(appendAndLocate("- [[P]]\n    - a\n", "- [[P]]\n    - x")).toBe(2)
  })

  it("skips a new bare [[P]] root line to its first child", () => {
    expect(appendAndLocate("", "- [[P]]\n    - x")).toBe(1)
  })

  it("points at a plain root added at the outline end", () => {
    expect(appendAndLocate("- a\n", "- y")).toBe(1)
  })

  it("is null when nothing changed", () => {
    expect(firstAppendedLine("- a\n", "- a\n")).toBeNull()
  })
})

describe("findSubtreeEnd", () => {
  it("includes inner blank lines and prose children, not trailing blanks", () => {
    const lines = ["- [[A]]", "    - one", "", "        deep prose", "    tail prose", "", "", "- [[B]]"]
    expect(findSubtreeEnd(lines, 0)).toBe(5)
    expect(findSubtreeEnd(lines, 1)).toBe(4)
    expect(findSubtreeEnd(lines, 7)).toBe(8)
  })

  it("counts a tab as 4 columns", () => {
    expect(findSubtreeEnd(["    - a", "\t- b", "\t\t- c"], 0)).toBe(1)
    expect(findSubtreeEnd(["- a", "\t- b", "\t\t- c", "- d"], 0)).toBe(3)
  })
})

describe("replaceLineText / cutSubtree", () => {
  it("replaceLineText swaps the whole line", () => {
    expect(replaceLineText("- a\r\n- b\r\n", 1, "- b", "- [x] b2")).toBe("- a\r\n- [x] b2\r\n")
  })

  it("throws StaleLineError when the line changed", () => {
    expect(() => replaceLineText("- a\n- b\n", 1, "- c", "- d")).toThrow(StaleLineError)
    expect(() => cutSubtree("- a\n- b\n", 0, "- b")).toThrow(StaleLineError)
    expect(() => cutSubtree("- a\n", 5, "- a")).toThrow(StaleLineError)
  })

  it("cutSubtree removes the subtree and re-bases it to indent 0", () => {
    const r = cutSubtree("- [[A]]\n    - [[C]]\n\n\t\t- d\n- [[B]]\n", 1, "    - [[C]]")
    expect(r.content).toBe("- [[A]]\n- [[B]]\n")
    expect(r.block).toEqual(["- [[C]]", "", "    - d"])
  })
})

describe("pasteUnderLinkBullet / pasteAtOutlineEnd", () => {
  it("reproduces the EDITOR.md §6 rule-3 example", () => {
    const content = "- [[Old parent]]\n    - [[Child]]\n        - detail line\n"
    const cut = cutSubtree(content, 1, "    - [[Child]]")
    expect(pasteUnderLinkBullet(cut.content, "New parent", cut.block)).toBe(
      "- [[Old parent]]\n- [[New parent]]\n    - [[Child]]\n        - detail line\n",
    )
  })

  it("pastes as the last children of an existing nested link bullet", () => {
    const content = "- [[Day]]\n    - [[New]]\n        - [[x]]\n- [[Other]]\n"
    expect(pasteUnderLinkBullet(content, "new", ["- [[C]]", "", "    - d"])).toBe(
      "- [[Day]]\n    - [[New]]\n        - [[x]]\n        - [[C]]\n\n            - d\n- [[Other]]\n",
    )
  })

  it("pasteAtOutlineEnd inserts the block as-is in a space-indented note", () => {
    expect(pasteAtOutlineEnd("---\na: 1\n---\n- [[A]]\nprose\n", ["- [[C]]", "    - d"])).toBe(
      "---\na: 1\n---\n- [[A]]\n- [[C]]\n    - d\nprose\n",
    )
    expect(pasteAtOutlineEnd("", ["- [[C]]"])).toBe("- [[C]]\n")
  })

  it("re-indents a pasted block with tabs in a tab-indented note", () => {
    const content = "- [[Old]]\n\t- [[Child]]\n\t\t- detail\n- [[New]]\n\t- [[x]]\n"
    const cut = cutSubtree(content, 1, "\t- [[Child]]")
    expect(cut.block).toEqual(["- [[Child]]", "    - detail"])
    expect(pasteUnderLinkBullet(cut.content, "New", cut.block)).toBe("- [[Old]]\n- [[New]]\n\t- [[x]]\n\t- [[Child]]\n\t\t- detail\n")
    expect(pasteAtOutlineEnd("- [[A]]\n\t- [[B]]\n", cut.block)).toBe("- [[A]]\n\t- [[B]]\n- [[Child]]\n\t- detail\n")
  })
})

describe("parseOutline / renderOutline", () => {
  it("reports empty for a blank outline", () => {
    expect(parseOutline("- \n   \n")).toEqual({ lines: [], issues: [{ kind: "empty" }] })
  })

  it("flags headings and plain bullets (checkboxes included)", () => {
    const r = parseOutline("- ## H\n- buy milk\n- [ ] buy milk\n- [[ok]]\n- #tag\n- http://x")
    expect(r.issues).toEqual([
      { kind: "heading", line: 0 },
      { kind: "plain", line: 1 },
      { kind: "plain", line: 2 },
    ])
    expect(r.lines[2]).toEqual({ depth: 0, marker: "- [ ] ", text: "buy milk" })
  })

  it("parses markers, checkboxes, tabs and clamps depth", () => {
    const r = parseOutline("* [X] a #t\n\tb #t\n\t\t\t1. c #t  \n")
    expect(r.lines).toEqual([
      { depth: 0, marker: "- [x] ", text: "a #t" },
      { depth: 1, marker: "- ", text: "b #t" },
      { depth: 2, marker: "- ", text: "c #t" },
    ])
    expect(parseOutline("- a #t\n            - b #t").lines.map(l => l.depth)).toEqual([0, 1])
    expect(renderOutline(r.lines, 1)).toEqual(["    - [x] a #t", "        - b #t", "            - c #t"])
  })
})

describe("appendContent", () => {
  it("separates with one blank line and ends with a newline", () => {
    expect(appendContent("x\n", "## Decisions")).toBe("x\n\n## Decisions\n")
    expect(appendContent("x", "y\n\n")).toBe("x\n\ny\n")
    expect(appendContent("x\n\n", "y")).toBe("x\n\ny\n")
    expect(appendContent("", "y")).toBe("y\n")
    expect(appendContent("x\r\n", "a\nb")).toBe("x\r\n\r\na\r\nb\r\n")
  })
})

describe("splitEditableLine / lineHasIdentity", () => {
  it("splits list and heading prefixes", () => {
    expect(splitEditableLine("    - [ ] task [[A]]")).toEqual({ prefix: "    - [ ] ", text: "task [[A]]" })
    expect(splitEditableLine("12. item")).toEqual({ prefix: "12. ", text: "item" })
    expect(splitEditableLine("## Head")).toEqual({ prefix: "## ", text: "Head" })
    expect(splitEditableLine("prose")).toBeNull()
  })

  it("matches the indexed node's identity case-insensitively", () => {
    const text = {
      nodeType: "text",
      parsedTokens: [{ tokenType: "obsidian_link", source: "[[Alice]]", pageTarget: "Alice" }],
      tags: ["proj"],
    } as unknown as ParsedNode
    expect(lineHasIdentity("- met [[alice]] #proj", text)).toBe(true)
    expect(lineHasIdentity("- met [[bob]] #proj", text)).toBe(false)
    const page = { nodeType: "page", page: "Alice" } as unknown as ParsedNode
    expect(lineHasIdentity("- [[alice]]", page)).toBe(true)
    expect(lineHasIdentity("- alice", page)).toBe(false)
    const header = { nodeType: "header", page: "A", header: "Plans" } as unknown as ParsedNode
    expect(lineHasIdentity("## plans", header)).toBe(true)
  })
})
