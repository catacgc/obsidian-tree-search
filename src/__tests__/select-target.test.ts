import { describe, it, expect } from "bun:test"
import type { ParsedNode } from "@mdtree/core"
import type { TreeNode } from "../view/search/SearchViewFlatten"
import { findTargetRow, revealRow } from "../view/search/select-target"

const loc = (path: string, line: number) => ({ path, position: { start: { line, ch: 0 }, end: { line, ch: 0 } } })

function page(name: string, path: string, line = 0): ParsedNode {
    return { searchKey: "", location: loc(path, line), boost: 0, ageDays: 0, nodeType: "page", isReference: false, page: name, aliases: [], tags: [] }
}
function text(key: string, path: string, line: number): ParsedNode {
    return { searchKey: key, location: loc(path, line), boost: 0, ageDays: 0, nodeType: "text", parsedTokens: [], tags: [], isTask: false, isCompleted: false }
}
function rowsOf(...rs: [ParsedNode, number, Partial<TreeNode>?][]): TreeNode[] {
    return rs.map(([node, indent, extra], index) => ({ node, indent, hasChildren: false, visible: true, selected: false, index, matched: true, ...extra }))
}

describe("findTargetRow", () => {
    const rows = rowsOf(
        [page("P", "P.md"), 0],
        [text("a", "Daily/2026-09-30.md", 1), 1],
        [text("x", "Daily/2026-09-30.md", 2), 1],
    )

    it("prefers an earlier location target over a key target matching an earlier row", () => {
        expect(findTargetRow(rows, [{ path: "Daily/2026-09-30.md", line: 2 }, { key: "[[p]]" }])).toBe(2)
    })

    it("falls back to the key when no row is at the location", () => {
        expect(findTargetRow(rows, [{ path: "Daily/2026-09-30.md", line: 9 }, { key: "[[p]]" }])).toBe(0)
    })

    it("never matches the synthetic archive row", () => {
        const withArchive = rowsOf([text("archive (3 items)", "", 0), 0, { archiveRow: true }], [text("archive (3 items)", "A.md", 4), 0])
        expect(findTargetRow(withArchive, [{ key: "archive (3 items)" }])).toBe(1)
    })

    it("is -1 when nothing matches", () => {
        expect(findTargetRow(rows, [{ path: "Other.md", line: 0 }, { key: "[[q]]" }])).toBe(-1)
    })
})

describe("revealRow", () => {
    it("shows a hidden row and its hidden ancestors, not its siblings", () => {
        const rows = rowsOf(
            [page("P", "P.md"), 0],
            [text("a", "D.md", 1), 1, { visible: false }],
            [text("a1", "D.md", 2), 2, { visible: false }],
            [text("a2", "D.md", 3), 2, { visible: false }],
        )
        expect(revealRow(rows, 2).map(r => r.visible)).toEqual([true, true, true, false])
        expect(rows[1].visible).toBe(false)
    })
})
