import { describe, it, expect } from "bun:test"
import type { ParsedNode, ParsedTextToken } from "@mdtree/core"
import type { TreeNode } from "../view/search/SearchViewFlatten"
import type { RaycastAction } from "../view/node-actions"
import { deleteTargetOf, type OwnPath } from "../view/editor/row-editing"
import { deleteConfirmText, filterPanelItems, moveUnderTargets, panelItems, type PanelContext } from "../view/search/action-panel"
import { DEFAULT_SEARCH_FILTERS } from "../view/react-context/settings"

const loc = (path: string, line: number) => ({ path, position: { start: { line, ch: 0 }, end: { line, ch: 0 } } })
const base = (path: string, line: number) => ({ searchKey: "", location: loc(path, line), boost: 0, ageDays: 0 })
const page = (name: string, path: string, line = 0): ParsedNode =>
    ({ ...base(path, line), nodeType: "page", isReference: false, page: name, aliases: [], tags: [] })
const text = (key: string, path: string, line: number, parsedTokens: ParsedTextToken[] = []): ParsedNode =>
    ({ ...base(path, line), searchKey: key, nodeType: "text", parsedTokens, tags: [], isTask: false, isCompleted: false })
const link = (source: string, embed = false): ParsedTextToken =>
    ({ tokenType: "obsidian_link", source, pageTarget: "", ...(embed ? { embed: true as const } : {}) })
const row = (node: ParsedNode, indent: number, extra: Partial<TreeNode> = {}): TreeNode =>
    ({ node, indent, hasChildren: false, visible: true, selected: false, index: 0, matched: true, ...extra })
const rowsOf = (...rs: TreeNode[]) => rs.map((r, i) => ({ ...r, index: i }))

const OWN: Record<string, string> = { "project x": "Project X.md", "new": "New.md" }
const ownPath: OwnPath = n => n.nodeType === "page" || n.nodeType === "header" ? OWN[n.page.toLowerCase()] ?? null : null

// 0 Project X · 1   loose text (in Project X.md) · 2 New
const tree = rowsOf(
    row(page("Project X", "Project X.md"), 0),
    row(text("loose", "Project X.md", 7), 1),
    row(page("New", "New.md"), 0),
)

const tsUri = (action: string) => `obsidian://tree-search-uri?raycastaction=${action}&vault=v&filepath=x`
const ACTIONS: RaycastAction[] = [
    { type: "browse", url: "https://example.com", title: "Browse example", icon: "", shortcut: { modifiers: [], key: "enter" } },
    { type: "browse", url: tsUri("highlight"), title: "See in Obsidian", icon: "", shortcut: { modifiers: ["shift"], key: "enter" } },
    { type: "copy", text: "[[x]]", title: "Copy Node", icon: "" },
    { type: "browse", url: tsUri("insert"), title: "Insert After", icon: "" },
    { type: "browse", url: tsUri("archive"), title: "Archive", icon: "", keepOpen: true },
]

const ctx = (over: Partial<PanelContext> = {}): PanelContext => ({
    rowActions: ACTIONS, rows: tree, selectedPos: 1,
    allowEditing: true, allowTimeline: true, timelineActive: false, ownPath, chainMode: null, resolveLink: () => null,
    query: "", filters: [], ...over,
})
const titles = (c: PanelContext, section?: string) => panelItems(c).filter(i => !section || i.section === section).map(i => i.title)

describe("panelItems", () => {
    it("lists only the View section when no row is selected", () => {
        const items = panelItems(ctx({ rowActions: [], selectedPos: -1 }))
        expect(new Set(items.map(i => i.section))).toEqual(new Set(["view"]))
        expect(items.map(i => i.title)).toEqual(["Quick Add", "Show timeline", "Expand one level", "Collapse one level", "Collapse all", "Rebuild index"])
    })

    it("maps row actions to their shortcut keys and drops Insert after when Append exists", () => {
        const row = panelItems(ctx()).filter(i => i.section === "row")
        expect(row.map(i => i.title)).toEqual(["Browse example", "See in Obsidian", "Copy Node", "Archive", "Move to…"])
        expect(row.map(i => i.key?.label)).toEqual(["Enter", "Enter", "C", "X", "M"])
        expect(row[1].key?.shift).toBe(true)
    })

    it("keeps Insert after in views without editor mode, which also have no Edit section", () => {
        const c = ctx({ allowEditing: false, allowTimeline: false })
        expect(titles(c, "row")).toContain("Insert After")
        expect(titles(c, "edit")).toEqual([])
        expect(titles(c, "view")).not.toContain("Quick Add")
    })

    it("replaces the folder-picker Move To with Move to… for movable rows, in every view", () => {
        const withMove = [...ACTIONS, { type: "browse", url: tsUri("moveToFolder"), title: "Move To", icon: "" } as RaycastAction]
        for (const allowEditing of [true, false]) {
            const row = titles(ctx({ rowActions: withMove, selectedPos: 0, allowEditing }), "row")
            expect(row).not.toContain("Move To")
            expect(row).toContain("Move to…")
        }
        const headerRows = rowsOf(row({ ...base("P.md", 2), nodeType: "header", page: "P", header: "H", indent: 1 } as ParsedNode, 0))
        expect(titles(ctx({ rows: headerRows, selectedPos: 0 }), "row")).not.toContain("Move to…")
    })

    it("offers a Task section, before Edit, for an open task row only, in every view", () => {
        const task = (done: boolean) => rowsOf(row(page("Project X", "Project X.md"), 0),
            row({ ...text("call", "Project X.md", 3), isTask: true, isCompleted: done } as ParsedNode, 1))
        const open = ctx({ rows: task(false) })
        expect(titles(open, "task")).toEqual(["Done", "Today", "Tomorrow", "Weekend", "Next Week"])
        expect(panelItems(open).find(i => i.title === "Weekend")?.run).toEqual({ kind: "task", change: { kind: "schedule", when: "weekend" } })
        const sections = panelItems(open).map(i => i.section)
        expect(sections.indexOf("task")).toBeLessThan(sections.indexOf("edit"))
        expect(titles(ctx({ rows: task(false), allowEditing: false, timelineActive: true }), "task")).toHaveLength(5)
        expect(titles(ctx({ rows: task(true) }), "task")).toEqual([])
        expect(titles(ctx(), "task")).toEqual([])
    })

    it("Edit: Append to names the target page; Patch, Edit line, Move under and Delete only where they apply", () => {
        expect(titles(ctx(), "edit")).toEqual(["Append to [[Project X]]", "Patch", "Edit line", "Move under…", "Delete"])
        // A root page row: appendable, its own note renamed/trashed, not line-editable, not draggable.
        expect(titles(ctx({ selectedPos: 0 }), "edit")).toEqual(["Append to [[Project X]]", "Patch", "Rename [[Project X]]", "Delete"])
    })

    it("a link-line page row renames its note instead of offering Edit line", () => {
        const rows = rowsOf(row(page("New", "New.md"), 0), row(page("Project X", "Daily.md", 3), 1))
        const items = panelItems(ctx({ rows, selectedPos: 1 })).filter(i => i.section === "edit")
        expect(items.map(i => i.title)).toContain("Rename [[Project X]]")
        expect(items.map(i => i.title)).not.toContain("Edit line")
        expect(items.find(i => i.title === "Rename [[Project X]]")?.run).toEqual({ kind: "renameFile", path: "Project X.md" })
    })

    it("a text row renames each resolved link and embed once, in line order", () => {
        const tokens = [link("[[Alpha]]"), link("[[img.png]]", true), link("[[Alpha|a]]"), link("[[Ghost]]")]
        const rows = rowsOf(row(page("Project X", "Project X.md"), 0), row(text("t", "Project X.md", 2, tokens), 1))
        const resolveLink = (l: string) => ({ Alpha: "Alpha.md", "img.png": "assets/img.png" } as Record<string, string>)[l] ?? null
        const items = panelItems(ctx({ rows, selectedPos: 1, resolveLink })).filter(i => i.icon === "rename")
        expect(items.map(i => i.title)).toEqual(["Rename [[Alpha]]", "Rename ![[img.png]]"])
        expect(items[1].run).toEqual({ kind: "renameFile", path: "assets/img.png" })
    })

    it("hides Patch during a reparent chain", () => {
        expect(titles(ctx({ chainMode: "reparent" }), "edit")).not.toContain("Patch")
        expect(titles(ctx({ chainMode: "append" }), "edit")).toContain("Patch")
    })

    it("names Edit Rename for a heading", () => {
        const h: ParsedNode = { ...base("Project X.md", 3), nodeType: "header", page: "Project X", header: "Plan", indent: 1 }
        const rows = rowsOf(row(page("Project X", "Project X.md"), 0), row(h, 1))
        expect(titles(ctx({ rows, selectedPos: 1 }), "edit")).toContain("Rename")
        expect(titles(ctx(), "edit")).toContain("Edit line")
    })

    it("Append shows its own key", () => {
        const append = (c: PanelContext) => panelItems(c).find(i => i.id === "append")
        expect(append(ctx())?.key?.label).toBe("A")
    })

    it("Timeline: no Move under and no Tree-only view items", () => {
        const tl = rowsOf(row(text("loose", "Project X.md", 7), 0, { timeline: { breadcrumb: [page("Project X", "Project X.md")], pinned: false, ageDays: 0 } }))
        const c = ctx({ rows: tl, selectedPos: 0, timelineActive: true })
        expect(titles(c, "edit")).toEqual(["Append to [[Project X]]", "Patch", "Edit line", "Delete"])
        expect(titles(c, "view")).toEqual(["Quick Add", "Show tree", "Rebuild index"])
    })

    it("Filter: Save as Filter for a new query, Delete Filter for each active pill", () => {
        const c = ctx({ query: "foo is:task", filters: DEFAULT_SEARCH_FILTERS })
        expect(titles(c, "filter")).toEqual(["Save as Filter", 'Delete Filter "Tasks"'])
        expect(panelItems(c).find(i => i.id === "deleteFilter:Tasks")?.run).toEqual({ kind: "deleteFilter", name: "Tasks" })
    })

    it("Filter: no Save when the query is a saved filter's, ignoring whitespace", () => {
        expect(titles(ctx({ query: " is:task ", filters: DEFAULT_SEARCH_FILTERS }), "filter")).toEqual(['Delete Filter "Tasks"'])
    })

    it("Filter: nothing for a blank query", () => {
        expect(titles(ctx({ query: "", filters: DEFAULT_SEARCH_FILTERS }), "filter")).toEqual([])
    })

    it("Filter: nothing over a chain or in views without editor mode", () => {
        const over = { query: "is:task", filters: DEFAULT_SEARCH_FILTERS }
        expect(titles(ctx({ ...over, chainMode: "append" }), "filter")).toEqual([])
        expect(titles(ctx({ ...over, allowEditing: false }), "filter")).toEqual([])
    })

    it("Filter: after Edit, before View", () => {
        const sections = panelItems(ctx({ query: "foo", filters: DEFAULT_SEARCH_FILTERS })).map(i => i.section)
        expect(sections.lastIndexOf("edit")).toBeLessThan(sections.indexOf("filter"))
        expect(sections.lastIndexOf("filter")).toBeLessThan(sections.indexOf("view"))
    })
})

describe("deleteConfirmText", () => {
    it("names what each kind of Delete removes", () => {
        const confirm = (pos: number, rows = tree) => deleteConfirmText(deleteTargetOf(rows[pos], ownPath, false)!, "L")
        expect(confirm(1)).toEqual({ title: `Delete "L" and everything nested under it?`, action: "Delete" })
        expect(confirm(0)).toEqual({ title: `Move "Project X.md" to trash?`, action: "Move to trash" })
        const h = rowsOf(row({ ...base("Project X.md", 3), nodeType: "header", page: "Project X", header: "Plan", indent: 1 } as ParsedNode, 0))
        expect(confirm(0, h)).toEqual({ title: `Delete heading "L" and its section?`, action: "Delete" })
    })
})

describe("moveUnderTargets", () => {
    it("offers the valid drop targets of a draggable row, nothing for a root row", () => {
        expect(moveUnderTargets(tree, 1)).toEqual([2])
        expect(moveUnderTargets(tree, 0)).toEqual([])
        expect(moveUnderTargets(tree, -1)).toEqual([])
    })
})

describe("filterPanelItems", () => {
    it("matches titles case-insensitively and keeps everything for a blank query", () => {
        const items = panelItems(ctx())
        expect(filterPanelItems(items, "ARCH").map(i => i.title)).toEqual(["Archive"])
        expect(filterPanelItems(items, "  ")).toHaveLength(items.length)
    })
})
