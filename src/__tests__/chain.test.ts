import { describe, it, expect } from "bun:test"
import { buildGraphFromScanner, getKey, type ParsedNode, type ResultNode, type VaultScanner } from "@mdtree/core"
import {
    chainEditorText,
    chainOutline,
    chainPrevQuery,
    chainReplacesSearch,
    chainResults,
    isEntryInput,
    parseChainEntry,
    planReparent,
    type ChainAnchor,
    type ChainEntry,
    type ChainOutline,
    type ChainStep,
    type RowRef,
} from "../view/search/chain"
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
        expect(keys(chainResults(g, chain, "proj", "proj", ";", {}, "2026-09-30"))).toEqual(["projects"])
        expect(keys(chainResults(g, chain, "alph", "alph", ";", {}, "2026-09-30"))).not.toContain("[[alpha]]")
        expect(keys(chainResults(g, chain, "road", "road", ";", {}, "2026-09-30"))).toEqual(["[[roadmap]]"])
    })

    it("reparent of several rows: lines and folders for the query, none of the moved rows", async () => {
        const g = await buildGraphFromScanner(scanner)
        const ship = g.getNodeAttributes("ship [[alpha]]")
        const projects = g.getNodeAttributes("projects")
        const chain = { mode: "reparent" as const, children: [ref(ship), ref(projects)], prevQuery: "", confirm: null }
        const found = keys(chainResults(g, chain, "road", "road", ";", {}, "2026-09-30"))
        expect(found).toContain("[[roadmap]]")
        expect(found).not.toContain("ship [[alpha]]")
        const withFolders = keys(chainResults(g, { ...chain, children: [ref(ship), ref(folder("Other"))] }, "proj", "proj", ";", {}, "2026-09-30"))
        expect(withFolders).toContain("projects")
        expect(keys(chainResults(g, chain, "proj", "proj", ";", {}, "2026-09-30"))).not.toContain("projects")
    })

    it("append under a note: its children, filtered by the query; nothing once an entry is typed", async () => {
        const g = await buildGraphFromScanner(scanner)
        const chain = { mode: "append" as const, steps: [row({ kind: "note", name: "Alpha" })] }
        expect(keys(chainResults(g, chain, "", "", ";", {}, "2026-09-30"))).toEqual(["[[roadmap]]", "ship [[alpha]]"])
        expect(keys(chainResults(g, chain, "zzz", "zzz", ";", {}, "2026-09-30"))).toEqual([])
        const typed = { mode: "append" as const, steps: [...chain.steps, entry({ kind: "item", marker: "- ", text: "x" })] }
        expect(chainResults(g, typed, "", "", ";", {}, "2026-09-30")).toEqual([])
    })

    it("append: an expanded filter reference searches, though its `(` would read as an entry", async () => {
        const g = await buildGraphFromScanner(scanner)
        const chain = { mode: "append" as const, steps: [row({ kind: "note", name: "Alpha" })] }
        expect(keys(chainResults(g, chain, ":Road", "(road)", ";", {}, "2026-09-30"))).toEqual(["[[roadmap]]"])
    })

    it("append: an open [[frag anywhere in the input lists link targets, also after entry chips", async () => {
        const g = await buildGraphFromScanner(scanner)
        const chain = { mode: "append" as const, steps: [row({ kind: "note", name: "Alpha" })] }
        const q = "[[Beta]] and [[Road"
        expect(keys(chainResults(g, chain, q, q, ";", {}, "2026-09-30"))).toEqual(["[[roadmap]]"])
        expect(keys(chainResults(g, chain, "- see [[Road", "- see [[Road", ";", {}, "2026-09-30"))).toEqual(["[[roadmap]]"])
        const typed = { mode: "append" as const, steps: [...chain.steps, entry({ kind: "item", marker: "- ", text: "x" })] }
        expect(keys(chainResults(g, typed, "[[Road", "[[Road", ";", {}, "2026-09-30"))).toEqual(["[[roadmap]]"])
        expect(chainResults(g, chain, "[[Beta]] and [[", "[[Beta]] and [[", ";", {}, "2026-09-30")).toEqual([])
    })
})

const row = (anchor: ChainAnchor): ChainStep => ({ kind: "row", anchor, label: "row", prevQuery: "" })
const entry = (e: ChainEntry): ChainStep => ({ kind: "entry", entry: e, label: "entry", prevQuery: "" })
const parsed = (text: string): ChainEntry => parseChainEntry(text) as ChainEntry
const UNDER = { path: "List.md", line: 2, expectedLine: "- task list", label: "task list" }
const lineAnchor: ChainAnchor = { kind: "line", node: text("task list", "List.md", 2), target: UNDER }

describe("parseChainEntry", () => {
    it("reads aliases, headings, fields, items and notes", () => {
        expect(parseChainEntry("|a")).toEqual({ kind: "alias", alias: "a" })
        expect(parseChainEntry("#header")).toEqual({ kind: "heading", text: "header" })
        expect(parseChainEntry("## H")).toEqual({ kind: "heading", text: "H" })
        expect(parseChainEntry("(is:: project)")).toEqual({ kind: "field", key: "is", value: "project" })
        expect(parseChainEntry("is:: project")).toEqual({ kind: "field", key: "is", value: "project" })
        expect(parseChainEntry("[ ] t")).toEqual({ kind: "item", marker: "- [ ] ", text: "t" })
        expect(parseChainEntry("- plain")).toEqual({ kind: "item", marker: "- ", text: "plain" })
        expect(parseChainEntry("[[New Node]]")).toEqual({ kind: "note", link: { name: "New Node", header: null, alias: null, fields: [] } })
        expect(parseChainEntry("  ")).toBeNull()
    })

    it("refuses open links, empty values and meta- fields", () => {
        expect(parseChainEntry("[[New")).toEqual({ error: "Close the link: [[name]]" })
        expect(parseChainEntry("(k:: )")).toEqual({ error: "Type a value after ::" })
        expect(parseChainEntry("meta-x:: y")).toEqual({ error: "meta- fields are reserved" })
    })
})

describe("isEntryInput", () => {
    it("takes a pasted markdown link as an entry, titled, untitled or with escaped brackets", () => {
        expect(isEntryInput("[title](https://x.com)")).toBe(true)
        expect(isEntryInput("[](https://x.com)")).toBe(true)
        expect(isEntryInput("[a \\[b\\]](https://x.com)")).toBe(true)
        expect(parseChainEntry("[x](https://x.com)")).toEqual({ kind: "item", marker: "- ", text: "[x](https://x.com)" })
    })
    it("keeps bracketed text without a destination a search", () => {
        expect(isEntryInput("[draft] notes")).toBe(false)
    })
})

describe("chainOutline", () => {
    const daily = "2026-09-30"
    const lines = (r: ChainOutline | { error: string }) => "error" in r ? r : r.lines.map(l => "    ".repeat(l.depth) + l.marker + l.text)

    it("nests a new note with its alias and heading, then a task under it", () => {
        const steps = [row({ kind: "note", name: "Note" }), entry(parsed("[[New Node]]")), entry(parsed("|new-alias")), entry(parsed("#header"))]
        const r = chainOutline(steps, parsed("[ ] task"), daily)
        expect(lines(r)).toEqual(["- [[Note]]", "    - [[New Node|new-alias]]", "        - [[New Node#header]]", "            - [ ] task"])
        expect(r).toMatchObject({ parentName: "Note", nextDepth: 4 })
    })

    it("patches the anchor note's own link with an alias, a field or a heading", () => {
        const steps = [row({ kind: "note", name: "Note" })]
        expect(lines(chainOutline(steps, parsed("|alias"), daily))).toEqual(["- [[Note|alias]]"])
        expect(lines(chainOutline(steps, parsed("(is:: project)"), daily))).toEqual(["- [[Note]] (is:: project)"])
        expect(lines(chainOutline([...steps, entry(parsed("#h"))], parsed("[ ] t"), daily))).toEqual(["- [[Note#h]]", "    - [ ] t"])
    })

    it("nests items under a picked line", () => {
        const r = chainOutline([row(lineAnchor), entry(parsed("[ ] add task"))], parsed("[ ] add subtask"), daily)
        expect(lines(r)).toEqual(["- [ ] add task", "    - [ ] add subtask"])
        expect(r).toMatchObject({ underLine: UNDER })
    })

    it("patches today's note through a root link", () => {
        expect(lines(chainOutline([row({ kind: "today" })], parsed("|a"), daily))).toEqual([`- [[${daily}|a]]`])
    })

    it("refuses aliases under a line and headings under an item", () => {
        expect(chainOutline([row(lineAnchor)], parsed("|a"), daily)).toEqual({ error: "Aliases and properties apply to notes — pick one or type [[name]] first" })
        expect(chainOutline([row({ kind: "note", name: "N" }), entry(parsed("[ ] x"))], parsed("#h"), daily))
            .toEqual({ error: "Headings go under a note — pick one or type [[name]] first" })
    })
})

describe("chainEditorText", () => {
    it("ends with an empty bullet under the deepest line, caret at the end", () => {
        const o = chainOutline([row({ kind: "note", name: "P" })], null, "2026-09-30")
        if ("error" in o) throw new Error(o.error)
        expect(chainEditorText(o)).toEqual({ outline: "- [[P]]\n    - ", caret: 14 })
    })
})

describe("Quick Add (chip-less append chain)", () => {
    const quickAdd = (steps: ChainStep[] = []) => ({ mode: "append" as const, steps, quickAdd: { prevQuery: "before" } })

    it("runs the view's search until a chip or entry input, then the chain's own results", () => {
        expect(chainReplacesSearch(quickAdd(), "alpha")).toBe(false)
        expect(chainReplacesSearch(quickAdd(), "- new item")).toBe(true)
        expect(chainReplacesSearch(quickAdd([row({ kind: "note", name: "P" })]), "alpha")).toBe(true)
    })

    it("writes typed text into today's daily note, with no parent", () => {
        expect(chainOutline([], parsed("- call Bob"), "2026-09-30")).toEqual({ lines: [{ depth: 0, marker: "- ", text: "call Bob" }], nextDepth: 1 })
    })

    it("restores the query typed before Quick Add, not the first chip's", () => {
        expect(chainPrevQuery(quickAdd([{ ...row({ kind: "note", name: "P" }), prevQuery: "chip" }]))).toBe("before")
        expect(chainPrevQuery({ mode: "append", steps: [{ ...row({ kind: "note", name: "P" }), prevQuery: "chip" }] })).toBe("chip")
    })
})
