import { describe, it, expect } from "bun:test"
import { DEFAULT_SETTINGS, getKey, indexSinglePage, NotesGraph, parseVaultFile, type ParsedNode } from "@mdtree/core"
import type { RowRef } from "../view/search/chain"
import { bulkNotice, currentNode, cutCarriers, cutKeyOf, removeCut, toggleCut } from "../view/search/cut-drawer"

const MTIME = 1_700_000_000_000
const loc = (path: string, line: number) => ({ path, position: { start: { line, ch: 0 }, end: { line, ch: 0 } } })
const base = (path: string, line: number) => ({ searchKey: "", location: loc(path, line), boost: 0, ageDays: 0 })
const text = (key: string, path: string, line: number): ParsedNode =>
    ({ ...base(path, line), searchKey: key, nodeType: "text", parsedTokens: [], tags: [], isTask: false, isCompleted: false })
const page = (name: string, path: string): ParsedNode =>
    ({ ...base(path, 0), nodeType: "page", isReference: false, page: name, aliases: [], tags: [] })
const folder = (path: string): ParsedNode =>
    ({ ...base(path, 0), nodeType: "folder", path, name: path.split("/").pop()!, folderNote: `${path}/x.md` })
const attachment = (name: string): ParsedNode =>
    ({ ...base(name, 0), nodeType: "attachment", name, extension: "png", aliases: [] })
const ref = (node: ParsedNode, label = "label"): RowRef => ({ node, label, parent: null })

const graphOf = (content: string, path = "Note.md") => {
    const g = new NotesGraph()
    indexSinglePage(parseVaultFile(content, path, MTIME), g, DEFAULT_SETTINGS)
    return g
}

describe("cutKeyOf", () => {
    it("keys a folder note row by its folder", () => {
        const f = folder("Projects")
        const fn = { ...base("Projects/Projects.md", 0), nodeType: "folderNote", folder: f, page: page("Projects", "Projects/Projects.md") } as ParsedNode
        expect(cutKeyOf(fn)).toBe(getKey(f))
    })
})

describe("toggleCut / removeCut", () => {
    const a = ref(text("a", "N.md", 0)), b = ref(text("b", "N.md", 1)), c = ref(text("c", "N.md", 2))

    it("appends a new row, takes out a row already in, and keeps the order", () => {
        const items = toggleCut(toggleCut(toggleCut([], a), b), c)
        expect(items.map(r => r.node.searchKey)).toEqual(["a", "b", "c"])
        expect(toggleCut(items, ref(text("b", "N.md", 9))).map(r => r.node.searchKey)).toEqual(["a", "c"])
    })

    it("removes every done row by key", () => {
        expect(removeCut([a, b, c], [c, a]).map(r => r.node.searchKey)).toEqual(["b"])
    })
})

describe("currentNode", () => {
    it("follows a text row whose line shifted", () => {
        const stale = text("b [[x]]", "Note.md", 0)
        const g = graphOf("- a [[x]]\n- b [[x]]\n")
        expect(currentNode(g, stale)?.location.position.start.line).toBe(1)
    })

    it("is null when the row's key is gone", () => {
        expect(currentNode(graphOf("- a [[x]]\n"), text("gone [[x]]", "Note.md", 0))).toBeNull()
    })

    it("returns other rows unchanged", () => {
        const p = page("Missing", "Missing.md")
        expect(currentNode(new NotesGraph(), p)).toBe(p)
    })
})

describe("cutCarriers", () => {
    const contents = new Map([["N.md", "- a [[X]]\n    - b [[X]]\n        - d [[X]]\n- c [[X]]\n"]])
    const none = () => null

    it("maps a line inside another cut line's subtree to its outermost cut ancestor", () => {
        const items = [ref(text("a", "N.md", 0)), ref(text("b", "N.md", 1)), ref(text("d", "N.md", 2)), ref(text("c", "N.md", 3))]
        expect([...cutCarriers(items, contents, none)]).toEqual([["b", "a"], ["d", "a"]])
    })

    it("never carries across files, nor when the file wasn't read", () => {
        const items = [ref(text("a", "N.md", 0)), ref(text("b", "M.md", 1))]
        expect(cutCarriers(items, contents, none).size).toBe(0)
        expect(cutCarriers([ref(text("a", "Z.md", 0)), ref(text("b", "Z.md", 1))], contents, none).size).toBe(0)
    })

    it("carries files and folders inside a cut folder, not its siblings", () => {
        const items = [ref(folder("Projects")), ref(attachment("img.png")), ref(folder("Projects/Old")), ref(folder("Projectsx"))]
        const filePathOf = (n: ParsedNode) => n.nodeType === "attachment" ? "Projects/img.png" : null
        expect(cutCarriers(items, contents, filePathOf)).toEqual(new Map([["img.png", "projects"], ["projects/old", "projects"]]))
    })
})

describe("bulkNotice", () => {
    const fail = (label: string, reason = "Pick a folder") => ({ label, reason })

    it("keeps one row silent on success and shows its own reason on failure", () => {
        expect(bulkNotice("Moved", 1, 1, [])).toBeNull()
        expect(bulkNotice("Moved", 0, 1, [fail("foo", "Out of date")])).toBe("Out of date")
    })

    it("counts several rows, listing failures", () => {
        expect(bulkNotice("Moved", 3, 3, [])).toBe("Moved 3 items")
        expect(bulkNotice("Moved", 2, 3, [fail("foo")])).toBe("Moved 2 of 3.\nfoo: Pick a folder")
    })

    it("lists at most five failures", () => {
        const failures = Array.from({ length: 7 }, (_, i) => fail(`f${i}`))
        const lines = bulkNotice("Archived", 1, 8, failures)!.split("\n")
        expect(lines[0]).toBe("Archived 1 of 8.")
        expect(lines.slice(1, 6)).toEqual(["f0", "f1", "f2", "f3", "f4"].map(l => `${l}: Pick a folder`))
        expect(lines[6]).toBe("…and 2 more")
        expect(lines).toHaveLength(7)
    })
})
