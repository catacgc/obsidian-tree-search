import { describe, it, expect } from "bun:test"
import { buildGraphFromScanner, type ParsedNode, type VaultScanner } from "@mdtree/core"
import {
    extendPath,
    fieldLines,
    linkCrumbs,
    newLineLabel,
    newLineTarget,
    outlineTitle,
    rootLabel,
    shiftPins,
    type OutlineRoot,
    type OutlineState,
} from "../view/search/outline"

const DAILY = "2026-10-15"
const loc = (path: string, line: number) => ({ path, position: { start: { line, ch: 0 }, end: { line, ch: 0 } } })
const base = (path: string, line: number) => ({ searchKey: "", location: loc(path, line), boost: 0, ageDays: 0 })
const page = (name: string): ParsedNode =>
    ({ ...base(`${name}.md`, 0), nodeType: "page", isReference: false, page: name, aliases: [], tags: [] })
const header = (pageName: string, h: string): ParsedNode =>
    ({ ...base(`${pageName}.md`, 3), nodeType: "header", page: pageName, header: h, indent: 1 })
const text = (key: string, path: string, line: number): ParsedNode =>
    ({ ...base(path, line), searchKey: key, nodeType: "text", parsedTokens: [{ tokenType: "text", text: key, decoration: "none" }], tags: [], isTask: false, isCompleted: false })
const crumb = (node: ParsedNode, label = "label"): OutlineRoot => ({ kind: "node", node, label })
const TODAY: OutlineRoot = { kind: "today" }
const outline = (path: OutlineRoot[], over: Partial<OutlineState> = {}): OutlineState =>
    ({ path, filters: [], prevQuery: "", returnTo: [], quickAdd: false, pins: [], mode: "edit", ...over })

describe("shiftPins", () => {
    it("moves pins at or after an inserted block down by its size", () => {
        const pins = [{ path: "a.md", line: 2 }, { path: "a.md", line: 5 }, { path: "a.md", line: 9 }]
        expect(shiftPins(pins, "a.md", [{ at: 5, count: 2 }], [])).toEqual([{ path: "a.md", line: 2 }, { path: "a.md", line: 7 }, { path: "a.md", line: 11 }])
    })

    it("applies several blocks in written-file order", () => {
        expect(shiftPins([{ path: "a.md", line: 11 }], "a.md", [{ at: 3, count: 1 }, { at: 12, count: 2 }], [])).toEqual([{ path: "a.md", line: 14 }])
    })

    it("leaves pins in other files untouched", () => {
        expect(shiftPins([{ path: "b.md", line: 9 }], "a.md", [{ at: 1, count: 3 }], [])).toEqual([{ path: "b.md", line: 9 }])
    })

    it("pins the added lines, once each", () => {
        expect(shiftPins([{ path: "a.md", line: 2 }], "a.md", [{ at: 3, count: 2 }], [2, 3, 4])).toEqual([
            { path: "a.md", line: 2 }, { path: "a.md", line: 3 }, { path: "a.md", line: 4 }])
    })
})

describe("fieldLines", () => {
    it("trims the first line", () => {
        expect(fieldLines("  buy milk  ")).toEqual({ first: "buy milk", extra: [] })
    })

    it("reads added lines with depths relative to the edited line", () => {
        expect(fieldLines("buy milk\n    - [ ] oat\n        - brand\n- shop").extra).toEqual([
            { depth: 1, marker: "- [ ] ", text: "oat" },
            { depth: 2, marker: "- ", text: "brand" },
            { depth: 0, marker: "- ", text: "shop" },
        ])
    })

    it("drops blank added lines", () => {
        expect(fieldLines("x\n\n   \n    - y\n- ").extra).toEqual([{ depth: 1, marker: "- ", text: "y" }])
    })
})

describe("extendPath", () => {
    it("skips an added crumb that repeats the last one", () => {
        const note = crumb(page("Note"))
        const line = crumb(text("a line", "Note.md", 4))
        expect(extendPath([note], [crumb(page("Note")), line], DAILY)).toEqual([note, line])
    })

    it("knows a line crumb by its file and line, not its object", () => {
        const line = crumb(text("a line", "Note.md", 4))
        expect(extendPath([line], [crumb(text("a line", "Note.md", 4))], DAILY)).toEqual([line])
        expect(extendPath([line], [crumb(text("a line", "Note.md", 5))], DAILY)).toHaveLength(2)
    })

    it("takes today's daily note page as the Today crumb", () => {
        expect(extendPath([TODAY], [crumb(page(DAILY))], DAILY)).toEqual([TODAY])
    })
})

describe("newLineTarget", () => {
    it("writes into today's daily note at the search root and at Today", () => {
        expect(newLineTarget(null)).toEqual({ kind: "daily" })
        expect(newLineTarget(TODAY)).toEqual({ kind: "daily" })
    })

    it("writes into today's daily note under a link to a note or heading root", () => {
        expect(newLineTarget(crumb(page("Project")))).toEqual({ kind: "daily", parentName: "Project" })
        expect(newLineTarget(crumb(header("Project", "Plan")))).toEqual({ kind: "daily", parentName: "Project#Plan" })
    })

    it("writes under a line root", () => {
        const line = text("errands", "Todo.md", 9)
        expect(newLineTarget(crumb(line))).toEqual({ kind: "under", node: line })
    })
})

describe("linkCrumbs", () => {
    const files: Record<string, string> = {
        "Project.md": "## Plan\n- step #p\n",
        [`${DAILY}.md`]: "- call [[Project]]\n",
    }
    const scanner: VaultScanner = {
        walkVault: async () => ({ files: Object.keys(files).map(path => ({ path, mtime: 1, type: "markdown" as const })), folders: [] }),
        readFile: async p => ({ content: files[p], mtime: 1 }),
    }
    const labels = (rs: OutlineRoot[] | null) => rs?.map(rootLabel) ?? null

    it("opens a note link on the note, and a heading link on the note then the heading", async () => {
        const g = await buildGraphFromScanner(scanner)
        expect(labels(linkCrumbs(g, "Project", undefined, DAILY))).toEqual(["Project"])
        expect(labels(linkCrumbs(g, "project", "Plan", DAILY))).toEqual(["Project", "Plan"])
    })

    it("stops at the note when the heading isn't indexed", async () => {
        const g = await buildGraphFromScanner(scanner)
        expect(labels(linkCrumbs(g, "Project", "Nope", DAILY))).toEqual(["Project"])
    })

    it("opens today's daily note as Today", async () => {
        const g = await buildGraphFromScanner(scanner)
        expect(linkCrumbs(g, DAILY, undefined, DAILY)).toEqual([TODAY])
    })

    it("is null for a note not in the graph", async () => {
        const g = await buildGraphFromScanner(scanner)
        expect(linkCrumbs(g, "Missing", undefined, DAILY)).toBeNull()
    })
})

describe("outlineTitle", () => {
    it("names the root, or the query at the search root", () => {
        expect(outlineTitle(outline([crumb(page("P"), "P"), crumb(header("P", "H"), "H")]))).toBe("Edit H")
        expect(outlineTitle(outline([], { prevQuery: "is:task " }))).toBe('Edit "is:task"')
        expect(outlineTitle(outline([]))).toBe("Edit search")
    })

    it("is Quick Add for a Quick Add session at Today only", () => {
        expect(outlineTitle(outline([TODAY], { quickAdd: true }))).toBe("Quick Add")
        expect(outlineTitle(outline([TODAY]))).toBe("Edit Today")
    })

    it("says Explore in explore mode", () => {
        expect(outlineTitle(outline([crumb(page("P"), "P")], { mode: "explore" }))).toBe("Explore P")
        expect(outlineTitle(outline([], { mode: "explore", prevQuery: "is:task" }))).toBe('Explore "is:task"')
    })
})

describe("newLineLabel", () => {
    it("names the root the New line writes under; the search root writes to Today", () => {
        expect(newLineLabel(outline([]))).toBe("Add to Today")
        expect(newLineLabel(outline([TODAY]))).toBe("Add to Today")
        expect(newLineLabel(outline([crumb(page("P"), "P")]))).toBe("Add to P")
    })
})
