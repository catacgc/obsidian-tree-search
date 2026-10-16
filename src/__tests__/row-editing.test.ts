import { describe, it, expect } from "bun:test"
import type { ParsedNode, ParsedTextToken } from "@mdtree/core"
import type { TreeNode } from "../view/search/SearchViewFlatten"
import {
    classifyReparent, deleteTargetOf, dragInfo, groupEnd, isEditableRow, isValidDropTarget,
    treeParentPos, type OwnPath,
} from "../view/editor/row-editing"
import {
    outlineIndent, linkQueryAt, acceptLink, linkAt, insertAttachmentBullets, caretNote,
    outlineBackspace, pasteOutline, changedRange, pasteLink, pastedUrl, ensureBullet,
    outlineEnter, outlineRepairs, toggleTask,
} from "../view/editor/textarea-ops"

// ── Fixtures ─────────────────────────────────────────────────────────────────

const loc = (path: string, line: number) => ({ path, position: { start: { line, ch: 0 }, end: { line, ch: 0 } } })
const base = (path: string, line: number) => ({ searchKey: "", location: loc(path, line), boost: 0, ageDays: 0 })

function page(name: string, path: string, line = 0): ParsedNode {
    return { ...base(path, line), nodeType: "page", isReference: false, page: name, aliases: [], tags: [] }
}
function header(pageName: string, name: string, path: string, line: number): ParsedNode {
    return { ...base(path, line), nodeType: "header", page: pageName, header: name, indent: 1 }
}
function text(key: string, path: string, line: number, tokens: ParsedTextToken[] = []): ParsedNode {
    return { ...base(path, line), searchKey: key, nodeType: "text", parsedTokens: tokens, tags: [], isTask: false, isCompleted: false }
}
const link = (pageTarget: string, headerName?: string): ParsedTextToken =>
    ({ tokenType: "obsidian_link", source: `[[${pageTarget}]]`, pageTarget, headerName })

function row(node: ParsedNode, indent: number, extra: Partial<TreeNode> = {}): TreeNode {
    return { node, indent, hasChildren: false, visible: true, selected: false, index: 0, matched: true, ...extra }
}
function rowsOf(...rs: TreeNode[]): TreeNode[] {
    return rs.map((r, i) => ({ ...r, index: i }))
}

// Own file of every page in the fixture vault; headers map to their page.
const OWN: Record<string, string> = { "project x": "Project X.md", "meeting": "Meeting.md", "old": "Old.md", "new": "New.md", "child": "Child.md" }
const ownPath: OwnPath = n => (n.nodeType === "page" || n.nodeType === "header") ? OWN[n.page.toLowerCase()] ?? null : null

// Tree:
// 0 Project X                     (indent 0)
// 1   [[Meeting]] link bullet in the daily note   (indent 1)
// 2     kickoff                   (indent 2)
// 3       notes                   (indent 3)
// 4   loose text                  (indent 1)
// 5 New                           (indent 0)
const tree = rowsOf(
    row(page("Project X", "Project X.md", 0), 0),
    row(page("Meeting", "2026-09-30.md", 3), 1),
    row(text("kickoff", "2026-09-30.md", 4), 2),
    row(text("notes", "2026-09-30.md", 5), 3),
    row(text("loose", "Project X.md", 7), 1),
    row(page("New", "New.md", 0), 0),
)

// ── row-editing ──────────────────────────────────────────────────────────────

describe("groups", () => {
    it("treeParentPos and groupEnd follow indentation", () => {
        expect(treeParentPos(tree, 3)).toBe(2)
        expect(treeParentPos(tree, 4)).toBe(0)
        expect(treeParentPos(tree, 0)).toBeNull()
        expect(groupEnd(tree, 0)).toBe(4)
        expect(groupEnd(tree, 1)).toBe(3)
        expect(groupEnd(tree, 3)).toBe(3)
    })
})

describe("isEditableRow", () => {
    it("edits text/headers and link-line pages, never own-file pages or the Archive row", () => {
        expect(isEditableRow(tree[2], ownPath, false)).toBe(true)
        expect(isEditableRow(tree[1], ownPath, false)).toBe(true)
        expect(isEditableRow(tree[0], ownPath, false)).toBe(false)
        expect(isEditableRow(tree[0], ownPath, true)).toBe(false)
        const fmChild = row(page("Child", "Child.md", 0), 1)
        expect(isEditableRow(fmChild, ownPath, false)).toBe(false)
        expect(isEditableRow(row(page("Archive", ""), 0, { archiveRow: true }), ownPath, true)).toBe(false)
    })

    it("renames attachments that are files of their own, not unresolved references", () => {
        const att: ParsedNode = { ...base("assets/photo.png", 0), nodeType: "attachment", name: "photo.png", extension: "png", aliases: [] }
        const own: OwnPath = n => n.nodeType === "attachment" ? "assets/photo.png" : null
        expect(isEditableRow(row(att, 1), own, false)).toBe(true)
        expect(isEditableRow(row(att, 1), () => null, false)).toBe(false)
    })
})

describe("deleteTargetOf", () => {
    it("deletes link-line and text rows as lines with their nested lines", () => {
        expect(deleteTargetOf(tree[1], ownPath, false)).toEqual({ kind: "line", path: "2026-09-30.md", line: 3 })
        expect(deleteTargetOf(tree[2], ownPath, false)).toEqual({ kind: "line", path: "2026-09-30.md", line: 4 })
    })

    it("trashes a note's own row and deletes a real heading with its section", () => {
        expect(deleteTargetOf(tree[0], ownPath, false)).toEqual({ kind: "file", path: "Project X.md" })
        expect(deleteTargetOf(row(header("Project X", "Decisions", "Project X.md", 4), 1), ownPath, false))
            .toEqual({ kind: "heading", path: "Project X.md", line: 4 })
    })

    it("offers nothing for the Archive row or folders", () => {
        expect(deleteTargetOf(row(page("Archive", ""), 0, { archiveRow: true }), ownPath, false)).toBeNull()
        const folder: ParsedNode = { ...base("Projects", 0), nodeType: "folder", path: "Projects", name: "Projects", folderNote: "" }
        expect(deleteTargetOf(row(folder, 0), ownPath, false)).toBeNull()
    })
})

describe("drag", () => {
    it("isValidDropTarget rejects self, the parent, descendants and non-pages", () => {
        expect(isValidDropTarget(tree, 1, 1)).toBe(false) // self
        expect(isValidDropTarget(tree, 1, 0)).toBe(false) // parent
        expect(isValidDropTarget(tree, 1, 3)).toBe(false) // descendant
        expect(isValidDropTarget(tree, 2, 1)).toBe(false) // parent page
        expect(isValidDropTarget(tree, 2, 4)).toBe(false) // text row
        expect(isValidDropTarget(tree, 1, 5)).toBe(true)
        expect(isValidDropTarget(tree, 2, 0)).toBe(true)
    })

    it("rejects another row of the same page as the dragged or parent row", () => {
        const rows = rowsOf(...tree, row(page("Meeting", "Other.md", 1), 0))
        expect(isValidDropTarget(rows, 1, 6)).toBe(false) // same page as dragged
        expect(isValidDropTarget(rows, 2, 6)).toBe(false) // same page as parent
    })

    it("dragInfo refuses a row that links its parent inline", () => {
        const rows = rowsOf(
            row(page("Project X", "Project X.md", 0), 0),
            row(text("a", "d.md", 1, [link("project x")]), 1),
            row(header("Project X", "Plan", "Project X.md", 3), 1),
            row(text("b", "d.md", 2, [link("Project X", "plan")]), 2),
            row(text("c", "d.md", 3, [link("Other")]), 2),
        )
        expect(dragInfo(rows, 1)).toEqual({ draggable: false, refusal: "Linked inline — edit the text to change its parent" })
        expect(dragInfo(rows, 3)).toEqual({ draggable: false, refusal: "Linked inline — edit the text to change its parent" })
        expect(dragInfo(rows, 4)).toEqual({ draggable: true })
        expect(dragInfo(rows, 0)).toEqual({ draggable: false }) // root
        expect(dragInfo(rows, 2)).toEqual({ draggable: false }) // header
    })

    it("dragInfo refuses Timeline and Archive rows", () => {
        const tl = rowsOf(row(page("P", "P.md", 0), 0), row(text("x", "d.md", 1), 1, { timeline: { breadcrumb: [], pinned: false, ageDays: 0 } }))
        expect(dragInfo(tl, 1).draggable).toBe(false)
        const ar = rowsOf(row(page("Archive", ""), 0, { archiveRow: true }), row(page("Old", "Old.md", 0), 1))
        expect(dragInfo(ar, 1).draggable).toBe(false)
    })
})

describe("classifyReparent", () => {
    it("frontmatter: a page child whose own file holds the relation at line 0", () => {
        const rows = rowsOf(row(page("Old", "Old.md", 0), 0), row(page("Child", "Child.md", 0), 1), row(page("New", "New.md", 0), 0))
        expect(classifyReparent(rows, 1, 2, ownPath, "parent")).toEqual({
            kind: "frontmatter", childPath: "Child.md", oldName: "Old", newName: "New", relation: "parent",
        })
    })

    it("cross-file: a bullet written in the old parent's own file", () => {
        expect(classifyReparent(tree, 4, 5, ownPath, "parent")).toEqual({
            kind: "cross-file", sourcePath: "Project X.md", line: 7, head: "", newName: "New", stampDate: null,
        })
    })

    it("same-file: a bullet under a link bullet in another file", () => {
        expect(classifyReparent(tree, 2, 5, ownPath, "parent")).toEqual({
            kind: "same-file", sourcePath: "2026-09-30.md", line: 4, head: "", newName: "New",
        })
        // a page link line under a link bullet is also a bullet move
        expect(classifyReparent(tree, 1, 5, ownPath, "parent")).toMatchObject({ kind: "same-file", line: 3 })
    })
})

// ── textarea-ops ─────────────────────────────────────────────────────────────

describe("outlineIndent", () => {
    it("clamps to [0, previous indent + 4] and keeps the first line at 0", () => {
        const t = "- a\n- b"
        expect(outlineIndent(t, 7, 1)).toEqual({ text: "- a\n    - b", caret: 11 })
        expect(outlineIndent("- a\n    - b", 11, 1)).toEqual({ text: "- a\n    - b", caret: 11 })
        expect(outlineIndent("- a\n    - b", 11, -1)).toEqual({ text: "- a\n- b", caret: 7 })
        expect(outlineIndent(t, 7, -1)).toEqual({ text: t, caret: 7 })
        expect(outlineIndent(t, 2, 1)).toEqual({ text: t, caret: 2 })
    })
})

describe("outlineBackspace", () => {
    it("removes a bare-bullet line and joins to the end of the previous line", () => {
        expect(outlineBackspace("- [[P]]\n    - ", 14)).toEqual({ text: "- [[P]]", caret: 7 })
    })

    it("keeps the first line's marker, caret to its text start", () => {
        expect(outlineBackspace("- ", 2)).toEqual({ text: "- ", caret: 2 })
        expect(outlineBackspace("- a", 0)).toEqual({ text: "- a", caret: 2 })
    })

    it("drops a checkbox, caret after the marker", () => {
        expect(outlineBackspace("- [ ] a", 6)).toEqual({ text: "- a", caret: 2 })
    })

    it("joins a non-first line at its text start to the end of the previous line", () => {
        expect(outlineBackspace("- a\n    - b", 10)).toEqual({ text: "- ab", caret: 3 })
    })

    it("leaves Backspace inside a line's text to the default", () => {
        expect(outlineBackspace("- [[P]]\n    - x", 15)).toBeNull()
    })
})

describe("outlineEnter", () => {
    it("starts a child bullet one level deeper on the first line", () => {
        expect(outlineEnter("- a", 3)).toEqual({ text: "- a\n    - ", caret: 10 })
    })

    it("starts a sibling at the caret line's indent on later lines", () => {
        expect(outlineEnter("- a\n    - b", 11)).toEqual({ text: "- a\n    - b\n    - ", caret: 18 })
    })

    it("moves the text after the caret onto the new bullet", () => {
        expect(outlineEnter("- ab", 3)).toEqual({ text: "- a\n    - b", caret: 10 })
    })
})

describe("outlineRepairs", () => {
    it("accepts every list marker, checkboxes included", () => {
        expect(outlineRepairs("- a\n    - [ ] b\n* c\n1. d")).toEqual([])
    })

    it("bullets marker-less and blank lines after their indent and spaces bare markers", () => {
        expect(outlineRepairs("a\n    b\n-\n")).toEqual([
            { from: 0, insert: "- " }, { from: 6, insert: "- " }, { from: 9, insert: " " }, { from: 10, insert: "- " },
        ])
    })
})

describe("toggleTask", () => {
    it("adds a checkbox after the marker, caret kept in its text", () => {
        expect(toggleTask("- a\n    - b", 11)).toEqual({ text: "- a\n    - [ ] b", caret: 15 })
    })

    it("removes an existing checkbox", () => {
        expect(toggleTask("- a\n    - [ ] b", 15)).toEqual({ text: "- a\n    - b", caret: 11 })
    })

    it("bullets a plain line first", () => {
        expect(toggleTask("foo", 3)).toEqual({ text: "- [ ] foo", caret: 9 })
    })

    it("moves a caret inside the prefix after the checkbox", () => {
        expect(toggleTask("- a", 0)).toEqual({ text: "- [ ] a", caret: 6 })
    })
})

describe("ensureBullet", () => {
    it("bullets a plain line after its indent, caret shifted", () => {
        expect(ensureBullet("- a\nfoo", 7)).toEqual({ text: "- a\n- foo", caret: 9 })
        expect(ensureBullet("    foo", 7)).toEqual({ text: "    - foo", caret: 9 })
    })

    it("leaves a list line alone and spaces a bare marker", () => {
        expect(ensureBullet("* foo", 5)).toEqual({ text: "* foo", caret: 5 })
        expect(ensureBullet("    -", 5)).toEqual({ text: "    - ", caret: 6 })
    })
})

describe("pasteOutline", () => {
    it("at a bare bullet: the first line fills it, nested lines keep their relative depth", () => {
        expect(pasteOutline("- [[P]]\n    - ", 14, 14, "- a\n    - b\n        - c\n- d"))
            .toEqual({ text: "- [[P]]\n    - a\n        - b\n            - c\n    - d", caret: 51 })
    })
    it("bullets plain lines, maps tabs to one level and drops blanks", () => {
        expect(pasteOutline("- [[P]]\n    - ", 14, 14, "a\n\tb\n\nc")?.text).toBe("- [[P]]\n    - a\n        - b\n    - c")
    })
    it("maps 2-space indent units to 4-space levels and keeps other markers", () => {
        expect(pasteOutline("- ", 2, 2, "* a\n  * b\n    * c")?.text).toBe("- a\n    * b\n        * c")
    })
    it("a single line is inserted inline without its marker", () => {
        expect(pasteOutline("- foo ", 6, 6, "- bar")).toEqual({ text: "- foo bar", caret: 9 })
    })
    it("after text on the caret line: siblings below it at its indent", () => {
        expect(pasteOutline("    - foo\n- z", 9, 9, "- a\n    - b")).toEqual({ text: "    - foo\n    - a\n        - b\n- z", caret: 29 })
    })
    it("a blank caret line is replaced", () => {
        expect(pasteOutline("", 0, 0, "a\n    b")).toEqual({ text: "- a\n    - b", caret: 11 })
    })
    it("replaces the selection first", () => {
        expect(pasteOutline("- [[P]]\n    - old", 14, 17, "x\ny")).toEqual({ text: "- [[P]]\n    - x\n    - y", caret: 23 })
    })
    it("is null for blank text", () => {
        expect(pasteOutline("- ", 2, 2, "\n \n")).toBeNull()
    })
})

describe("pastedUrl", () => {
    it("accepts a single trimmed URL of any scheme", () => {
        expect(pastedUrl(" https://x.com/a ")).toBe("https://x.com/a")
        expect(pastedUrl("obsidian://open?vault=v")).toBe("obsidian://open?vault=v")
    })
    it("rejects text around or after the URL", () => {
        expect(pastedUrl("see https://x.com")).toBeNull()
        expect(pastedUrl("https://x.com\nfoo")).toBeNull()
    })
})

describe("pasteLink", () => {
    it("wraps the selection, caret after the link", () => {
        expect(pasteLink("- hello", 2, 7, "https://x.com", "")).toEqual({ text: "- [hello](https://x.com)", caret: 24 })
    })
    it("the selection beats the clipboard title", () => {
        expect(pasteLink("- hello", 2, 7, "https://x.com", "X")).toEqual({ text: "- [hello](https://x.com)", caret: 24 })
    })
    it("without a selection or title: caret between the brackets", () => {
        expect(pasteLink("- ", 2, 2, "https://x.com", "")).toEqual({ text: "- [](https://x.com)", caret: 3, selectionEnd: 3 })
    })
    it("selects the title, escaping its brackets", () => {
        expect(pasteLink("", 0, 0, "https://x.com", "a [b]")).toEqual({ text: "[a \\[b\\]](https://x.com)", caret: 1, selectionEnd: 8 })
    })
    it("is null in a destination slot, over a multi-line selection or over a URL", () => {
        expect(pasteLink("[s](", 4, 4, "https://x.com", "")).toBeNull()
        expect(pasteLink("[s](url)", 4, 7, "https://x.com", "")).toBeNull()
        expect(pasteLink("a\nb", 0, 3, "https://x.com", "")).toBeNull()
        expect(pasteLink("https://old.com", 0, 15, "https://x.com", "")).toBeNull()
    })
})

describe("changedRange", () => {
    it("keeps the common prefix and suffix without overlap", () => {
        expect(changedRange("abc", "abXc")).toEqual({ from: 2, to: 2, insert: "X" })
        expect(changedRange("aaa", "aa")).toEqual({ from: 2, to: 3, insert: "" })
        expect(changedRange("x", "x")).toEqual({ from: 1, to: 1, insert: "" })
    })
})

describe("links and attachments", () => {
    it("linkQueryAt / acceptLink / linkAt", () => {
        expect(linkQueryAt("- see [[Proj", 12)).toEqual({ start: 6, query: "Proj" })
        expect(linkQueryAt("- ![[img", 8)).toBeNull()
        expect(linkQueryAt("- [[a]] b", 9)).toBeNull()
        expect(acceptLink("x [[Pro]] y", 2, 7, "[[Project X]]")).toEqual({ text: "x [[Project X]] y", caret: 15 })
        expect(linkAt("a [[B#h|c]] ![[e.png]]", 5)).toBe("B")
        expect(linkAt("a [[B#h|c]] ![[e.png]]", 16)).toBeNull()
        expect(linkAt("a [[B]]", 1)).toBeNull()
    })

    it("insertAttachmentBullets fills an empty bullet then adds children", () => {
        expect(insertAttachmentBullets("- ", 2, ["a.png", "b.png"])).toEqual({
            text: "- ![[a.png]]\n    - ![[b.png]]", caret: 29,
        })
    })

    it("caretNote picks the caret line's link nearest the caret: the last one starting before it, else the first", () => {
        const t = "- [[A]] and ![[x.png]] [[B|b]] end"
        expect(caretNote(t, 0)).toBe("A")                  // before both
        expect(caretNote(t, 4)).toBe("A")                  // inside A
        expect(caretNote(t, t.indexOf(" and"))).toBe("A") // between A and B
        expect(caretNote(t, t.indexOf("[[B"))).toBe("A")  // right before B's `[[`
        expect(caretNote(t, t.indexOf("B|"))).toBe("B")   // inside B
        expect(caretNote(t, t.length)).toBe("B")          // after both
    })

    it("caretNote ignores links on other lines when the caret line has one", () => {
        const t = "- [[P]]\n    - [[A]] x [[B]]\n    - [[C]]"
        expect(caretNote(t, t.indexOf(" x"))).toBe("A")
        expect(caretNote(t, t.indexOf("\n    - [[C"))).toBe("B")
    })

    it("caretNote walks up to the nearest ancestor with a link, else null", () => {
        const t = "- [[A]]\n    - [[S]] sibling\n    - plain\n        - deeper"
        expect(caretNote(t, t.length)).toBe("A")
        expect(caretNote("- [[Q]]\n- root", 14)).toBeNull()
        expect(caretNote("- x", 3)).toBeNull()
    })
})
