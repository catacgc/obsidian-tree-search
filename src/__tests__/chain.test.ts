import { describe, it, expect } from "bun:test"
import { buildGraphFromScanner, getKey, type NotesGraph, type ParsedNode, type ResultNode, type VaultScanner } from "@mdtree/core"
import { addToPlan, chainPrefill, chainResults, dirtyBodyKeys, patchPath, planReparent, type RowRef } from "../view/search/chain"
import type { OwnPath } from "../view/editor/row-editing"
import type { DailyNoteConfig } from "../indexing/indexed-tree"

const loc = (path: string, line: number) => ({ path, position: { start: { line, ch: 0 }, end: { line, ch: 0 } } })
const base = (path: string, line: number) => ({ searchKey: "", location: loc(path, line), boost: 0, ageDays: 0 })
const page = (name: string, path = `${name}.md`, line = 0, isReference = false): ParsedNode =>
    ({ ...base(path, line), nodeType: "page", isReference, page: name, aliases: [], tags: [] })
const header = (pageName: string, h: string): ParsedNode =>
    ({ ...base(`${pageName}.md`, 3), nodeType: "header", page: pageName, header: h, indent: 1 })
const text = (key: string, path: string, line: number): ParsedNode =>
    ({ ...base(path, line), searchKey: key, nodeType: "text", parsedTokens: [{ tokenType: "text", text: key, decoration: "none" }], tags: [], isTask: false, isCompleted: false })
const folder = (path: string): ParsedNode =>
    ({ ...base(path, 0), nodeType: "folder", path, name: path.split("/").pop()!, folderNote: "" })

const ref = (node: ParsedNode, parent: ParsedNode | null = null, label = "label"): RowRef => ({ node, label, parent })

describe("dirtyBodyKeys", () => {
    it("lists only the buffers whose text differs from the loaded body", () => {
        const body = (key: string, original: string, text: string) => ({ key, path: key, heading: null, label: key, original, text })
        expect(dirtyBodyKeys({ "a.md": body("a.md", "x", "x"), "b.md": body("b.md", "x", "y") })).toEqual(["b.md"])
    })
})

describe("patchPath", () => {
    const files: Record<string, string> = {
        "Note.md": "## Goals\n- parent line #p\n    - child line #c\n",
        "Daily.md": "- talked to [[Note]]\n",
    }
    const scanner: VaultScanner = {
        walkVault: async () => ({ files: Object.keys(files).map(path => ({ path, mtime: 1, type: "markdown" as const })), folders: [] }),
        readFile: async p => ({ content: files[p], mtime: 1 }),
    }
    const find = (g: NotesGraph, nodeType: string, label: string) =>
        g.getNodeAttributes(g.filterNodes((_, n) => n.nodeType === nodeType && getKey(n).includes(label))[0])
    const rowsOf = (...rs: [ParsedNode, number][]) => rs.map(([node, indent], index) =>
        ({ node, indent, index, hasChildren: false, visible: true, selected: false, matched: true }))
    const labels = (ns: ParsedNode[]) => ns.map(n => n.nodeType === "page" ? n.page : n.nodeType === "header" ? `#${n.header}` : getKey(n))

    it("puts a top-level row under its in-note context: its heading, parent line and note", async () => {
        const g = await buildGraphFromScanner(scanner)
        const child = find(g, "text", "child line")
        expect(labels(patchPath(g, rowsOf([child, 0]), 0, false))).toEqual(["Note", "#Goals", "parent line #p", "child line #c"])
        expect(labels(patchPath(g, rowsOf([find(g, "header", "goals"), 0]), 0, false))).toEqual(["Note", "#Goals"])
    })

    it("follows the tree's ancestors as shown, and only those under a chain", async () => {
        const g = await buildGraphFromScanner(scanner)
        const note = find(g, "page", "note")
        const talked = find(g, "text", "talked")
        const rows = rowsOf([note, 0], [talked, 1])
        expect(labels(patchPath(g, rows, 1, false))).toEqual(["Note", "talked to [[note]]"])
        expect(labels(patchPath(g, rowsOf([find(g, "text", "child line"), 0]), 0, true))).toEqual(["child line #c"])
    })
})

describe("planReparent", () => {
    const cfg: DailyNoteConfig = { folder: "Daily", format: "YYYY-MM-DD", template: "" }
    const own: Record<string, string> = { child: "Notes/Child.md", project: "Project.md" }
    const ownPath: OwnPath = n => n.nodeType === "page" ? own[n.page.toLowerCase()] ?? null
        : n.nodeType === "attachment" && n.name === "plan.pdf" ? "Files/plan.pdf" : null
    const ctx = { ownPath, relation: "parent", cfg }
    const CHILD = page("Child", "Old.md", 5)
    const line = text("buy milk", "Shop.md", 4)

    it("R1: page under a page sets its frontmatter parent, naming the tree parent page to replace", () => {
        expect(planReparent(ref(CHILD, page("Old")), page("Project"), ctx)).toEqual({
            kind: "set-parent", childPath: "Notes/Child.md", childName: "Child", relation: "parent", newName: "Project", oldName: "Old", cfg })
        expect(planReparent(ref(CHILD, text("x", "a.md", 1)), page("Project"), ctx)).toMatchObject({ kind: "set-parent", oldName: null })
    })

    it("R2: page under a folder moves its file; a reference page has none", () => {
        expect(planReparent(ref(CHILD), folder("Work/Archive"), ctx)).toEqual({ kind: "to-folder", childPath: "Notes/Child.md", folderPath: "Work/Archive" })
        expect(planReparent(ref(page("Ghost", "x.md", 0, true)), folder("Work"), ctx)).toEqual({ error: "[[Ghost]] has no note to move" })
    })

    it("R3: page under a typed new name", () => {
        expect(planReparent(ref(CHILD), { nodeType: "newPage", name: "Someday" }, ctx)).toMatchObject({ kind: "set-parent", newName: "Someday" })
    })

    it("R4: line under a page or header goes under that link in today's note", () => {
        expect(planReparent(ref(line), page("Project"), ctx)).toEqual({
            kind: "to-daily", sourcePath: "Shop.md", line: 4, head: "", parentLink: "Project", cfg, stampDate: null })
        expect(planReparent(ref(line), header("Project", "Plan"), ctx)).toMatchObject({ kind: "to-daily", parentLink: "Project#Plan" })
    })

    it("R5: line under another line", () => {
        expect(planReparent(ref(line), text("errands", "Todo.md", 9), ctx)).toEqual({
            kind: "under-line", sourcePath: "Shop.md", line: 4, head: "", targetPath: "Todo.md", targetLine: 9, targetHead: "", stampDate: null })
    })

    it("R6: line under a typed new name", () => {
        expect(planReparent(ref(line), { nodeType: "newPage", name: "Groceries" }, ctx)).toMatchObject({ kind: "to-daily", parentLink: "Groceries" })
    })

    it("R7: headers and other rows can't be moved", () => {
        expect(planReparent(ref(header("Project", "Plan")), page("X"), ctx)).toEqual({ error: "Headings can't be moved — move their page or their lines" })
        const month: ParsedNode = { ...base("x.md", 0), nodeType: "month", month: 1, monthLiteral: "January", year: 2026 }
        expect(planReparent(ref(month), folder("Work"), ctx)).toEqual({ error: "This row can't be moved" })
    })

    it("moves folders and attachments into a folder only, never a folder into itself", () => {
        expect(planReparent(ref(folder("Work/Old")), folder("Archive"), ctx)).toEqual({ kind: "to-folder", childPath: "Work/Old", folderPath: "Archive" })
        expect(planReparent(ref(folder("Work")), folder("Work/Old"), ctx)).toEqual({ error: "Can't move a folder into itself" })
        expect(planReparent(ref(folder("Work")), page("X"), ctx)).toEqual({ error: "Pick a folder" })
        const pdf: ParsedNode = { ...base("Notes/P.md", 3), nodeType: "attachment", name: "plan.pdf", extension: "pdf", aliases: [] }
        expect(planReparent(ref(pdf), folder("Archive"), ctx)).toEqual({ kind: "to-folder", childPath: "Files/plan.pdf", folderPath: "Archive" })
        expect(planReparent(ref({ ...pdf, name: "gone.pdf" }), folder("Archive"), ctx)).toEqual({ error: "gone.pdf has no file to move" })
    })

    it("refuses a page under itself", () => {
        expect(planReparent(ref(CHILD), page("child"), ctx)).toEqual({ error: "Can't move a page under itself" })
    })
})

describe("chainResults", () => {
    const files: Record<string, string> = {
        "Projects/Alpha.md": "- [[Roadmap]]\n",
        "Projects/Beta.md": "- note\n",
        "Roadmap.md": "- [ ] ship [[Alpha]]\n",
    }
    const scanner: VaultScanner = {
        walkVault: async () => ({
            files: Object.keys(files).map(path => ({ path, mtime: 1, type: "markdown" as const })),
            folders: [{ path: "Projects", name: "Projects" }],
        }),
        readFile: async p => ({ content: files[p], mtime: 1 }),
    }
    const keys = (rs: ResultNode[]): string[] => rs.map(r => getKey(r.node))

    it("reparent of a page: other pages and matching folders, never the page itself", async () => {
        const g = await buildGraphFromScanner(scanner)
        const child = ref(page("Alpha", "Projects/Alpha.md"))
        const chain = { mode: "reparent" as const, children: [child], prevQuery: "", confirm: null }
        expect(keys(chainResults(g, chain, "proj", ";", {}))).toEqual(["projects"])
        expect(keys(chainResults(g, chain, "alph", ";", {}))).not.toContain("[[alpha]]")
        expect(keys(chainResults(g, chain, "road", ";", {}))).toEqual(["[[roadmap]]"])
    })

    it("reparent of several rows: lines and folders for the query, none of the moved rows", async () => {
        const g = await buildGraphFromScanner(scanner)
        const ship = g.getNodeAttributes("ship [[alpha]]")
        const projects = g.getNodeAttributes("projects")
        const chain = { mode: "reparent" as const, children: [ref(ship), ref(projects)], prevQuery: "", confirm: null }
        const found = keys(chainResults(g, chain, "road", ";", {}))
        expect(found).toContain("[[roadmap]]")
        expect(found).not.toContain("ship [[alpha]]")
        const withFolders = keys(chainResults(g, { ...chain, children: [ref(ship), ref(folder("Other"))] }, "proj", ";", {}))
        expect(withFolders).toContain("projects")
        expect(keys(chainResults(g, chain, "proj", ";", {}))).not.toContain("projects")
    })
})

describe("chainPrefill", () => {
    const p = (q: string) => chainPrefill(q, ".", "archive")

    it("turns is:task into an open task box, tags as typed, filter-ref parentheses included", () => {
        expect(p("is:task #home")).toBe("- [ ] #home ")
        expect(p("(is:task #home)")).toBe("- [ ] #home ")
    })

    it("keeps words and quoted text as typed", () => {
        expect(p("Apollo launch")).toBe("- Apollo launch ")
        expect(p('"Exact Phrase"')).toBe("- Exact Phrase ")
    })

    it("writes [[Note]] as a link and is:completed as a done box", () => {
        expect(p("[[Project X]] is:completed")).toBe("- [x] [[Project X]] ")
    })

    it("adds an emoji for has:emoji and the archive tag for is:archived", () => {
        expect(p("has:emoji")).toBe("- 🪴 ")
        expect(p("is:archived")).toBe("- #archive ")
    })

    it("ends with an open [[ for has:link unless a link is already there", () => {
        expect(p("is:task has:link")).toBe("- [ ] [[")
        expect(p("[[P]] has:link")).toBe("- [[P]] ")
    })

    it("takes an OR group's first alternative and drops negations, in:, outline: and other is: values", () => {
        expect(p("#home | #work")).toBe("- #home ")
        expect(p("-foo in:7d outline:x is:page")).toBe("- ")
    })

    it("carries over only the last stage", () => {
        expect(p("work.is:task #home")).toBe("- [ ] #home ")
    })

    it("is empty for a blank query", () => {
        expect(p("  ")).toBe("")
    })
})

describe("addToPlan", () => {
    const plan = (q: string) => addToPlan(q, ">", "archive")

    it("puts the line under a first-stage [[Note]] scope and pre-fills it from the last stage", () => {
        expect(plan("[[new page]] > is:task home")).toEqual({ note: "new page", prefill: "- [ ] home " })
        expect(plan("[[new page]] is:task home")).toEqual({ note: "new page", prefill: "- [ ] home " })
        expect(plan("[[new page]]")).toEqual({ note: "new page", prefill: "- " })
    })

    it("has no note without a first-stage scope: the whole search becomes the line", () => {
        expect(plan("is:task #home")).toEqual({ note: null, prefill: "- [ ] #home " })
        expect(plan("apollo > [[Project X]]")).toEqual({ note: null, prefill: "- [[Project X]] " })
        expect(plan("  ")).toEqual({ note: null, prefill: "" })
    })
})
