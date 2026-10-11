import { describe, it, expect } from "bun:test"
import { DEFAULT_SETTINGS, flattenIndex, getKey, indexSinglePage, NotesGraph, parseQuery, parseVaultFile, searchIndex } from "@mdtree/core"
import { buildTimelineRows, tagOutlineParents } from "../view/search/timeline-utils"
import type { TreeNode } from "../view/search/SearchViewFlatten"

const MTIME = 1_700_000_000_000

function graph() {
    const g = new NotesGraph()
    indexSinglePage(parseVaultFile("- met at [[Kickoff]] https://example.com/k", "Rares Vlasceanu.md", MTIME), g, DEFAULT_SETTINGS)
    indexSinglePage(parseVaultFile(
        "- [[UAE]]\n    - [[Rares Vlasceanu]] [analysis for requirements](https://example.com/a)", "2026-10-01.md", MTIME), g, DEFAULT_SETTINGS)
    return g
}

const isLine = (key: string) => key.startsWith("[[rares vlasceanu]] [analysis")

function treeRows(q: string) {
    const g = graph()
    const rows: TreeNode[] = flattenIndex(searchIndex(g, q, "."), 10, parseQuery(q, "."))
    tagOutlineParents(g, rows)
    return rows
}

describe("outline parent context", () => {
    it("Tree: a line under a note it links gets its outline parent as subtitle", () => {
        const row = treeRows("rares vlasceanu").find(r => isLine(r.node.searchKey))!
        expect(row.indent).toBe(1)
        expect(row.outlineParent && getKey(row.outlineParent)).toBe("[[uae]]")
    })

    it("Tree: a line under its outline parent gets no subtitle", () => {
        const row = treeRows("uae").find(r => isLine(r.node.searchKey))!
        expect(row.indent).toBeGreaterThan(0)
        expect(row.outlineParent).toBeUndefined()
    })

    it("Timeline: the breadcrumb is the outline parent, not the linked note", () => {
        const g = graph()
        const q = "rares vlasceanu"
        const rows = buildTimelineRows(null, g, searchIndex(g, q, "."), parseQuery(q, "."), null)
        const row = rows.find(r => isLine(r.node.searchKey))!
        expect(row.timeline!.breadcrumb.map(getKey)).toEqual(["[[uae]]"])
    })
})
