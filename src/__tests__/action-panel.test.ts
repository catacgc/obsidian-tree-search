import { describe, it, expect } from "bun:test"
import type { ParsedNode, ParsedTextToken } from "@mdtree/core"
import type { TreeNode } from "../view/search/SearchViewFlatten"
import type { RaycastAction } from "../view/node-actions"
import { deleteTargetOf, type OwnPath } from "../view/editor/row-editing"
import { deleteConfirmText, filterPanelItems, panelItems, type PanelContext } from "../view/search/action-panel"
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
    allowEditing: true, allowTimeline: true, timelineActive: false, ownPath, chainMode: null, outline: false, resolveLink: () => null,
    query: "", filters: [], rowCut: false, drawerCount: 0, addTo: null, ...over,
})
const titles = (c: PanelContext, section?: string) => panelItems(c).filter(i => !section || i.section === section).map(i => i.title)

describe("panelItems", () => {
    it("lists Add to last in the Edit section where the view shows it, with or without a selected row", () => {
        expect(titles(ctx({addTo: "Add to loose"}), "edit").at(-1)).toBe("Add to loose")
        expect(titles(ctx({addTo: "Add to Today", selectedPos: -1, rowActions: []}), "edit")).toEqual(["Edit search", "Add to Today"])
        expect(titles(ctx(), "edit")).not.toContain("Add to loose")
    })

    it("lists only Edit search and the View section when no row is selected", () => {
        const items = panelItems(ctx({ rowActions: [], selectedPos: -1 }))
        expect(new Set(items.map(i => i.section))).toEqual(new Set(["edit", "view"]))
        expect(items.map(i => i.title)).toEqual(["Edit search", "Show timeline", "Expand one level", "Collapse one level", "Collapse all", "Rebuild index"])
    })

    it("maps row actions to their shortcut keys and drops Insert after when Append exists", () => {
        const row = panelItems(ctx()).filter(i => i.section === "row")
        expect(row.map(i => i.title)).toEqual(["Browse example", "See in Obsidian", "Copy Node", "Archive", "Move under…", "Cut to drawer"])
        // Enter opens the row in the outline editor in views with editor mode, so the plain-Enter web link shows no key.
        expect(row.map(i => i.key?.label)).toEqual([undefined, "Enter", "C", "X", "M", "X"])
        expect(row[1].key?.shift).toBe(true)
        expect(panelItems(ctx({ chainMode: "reparent" })).find(i => i.title === "Browse example")?.key?.label).toBe("Enter")
        expect(panelItems(ctx({ allowEditing: false })).find(i => i.title === "Browse example")?.key?.label).toBe("Enter")
    })

    it("keeps Insert after in views without editor mode, which also have no Edit section", () => {
        const c = ctx({ allowEditing: false, allowTimeline: false })
        expect(titles(c, "row")).toContain("Insert After")
        expect(titles(c, "edit")).toEqual([])
    })

    it("replaces the folder-picker Move To with Move under… for movable rows, in every view", () => {
        const withMove = [...ACTIONS, { type: "browse", url: tsUri("moveToFolder"), title: "Move To", icon: "" } as RaycastAction]
        for (const allowEditing of [true, false]) {
            const row = titles(ctx({ rowActions: withMove, selectedPos: 0, allowEditing }), "row")
            expect(row).not.toContain("Move To")
            expect(row).toContain("Move under…")
        }
        const headerRows = rowsOf(row({ ...base("P.md", 2), nodeType: "header", page: "P", header: "H", indent: 1 } as ParsedNode, 0))
        expect(titles(ctx({ rows: headerRows, selectedPos: 0 }), "row")).not.toContain("Move under…")
    })

    it("adds an … in Obsidian item after each Open of a note in views with editor mode", () => {
        const open: RaycastAction = { type: "browse", url: tsUri("open"), title: "Open Project X", icon: "", shortcut: { modifiers: [], key: "enter" } }
        const c = ctx({ rowActions: [open], selectedPos: 0 })
        expect(titles(c, "row").slice(0, 2)).toEqual(["Open Project X", "Open Project X in Obsidian"])
        const item = panelItems(c).find(i => i.title === "Open Project X in Obsidian")
        expect(item?.run).toEqual({ kind: "action", action: open, inObsidian: true })
        expect(titles(ctx({ rowActions: [open], selectedPos: 0, allowEditing: false }), "row")).not.toContain("Open Project X in Obsidian")
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

    it("offers Unschedule for an open task with its own scheduled date or one from an open subtask", () => {
        const task = (key: string, done = false, inheritedDate?: string) => ctx({ rows: rowsOf(row(page("Project X", "Project X.md"), 0),
            row({ ...text(key, "Project X.md", 3), isTask: true, isCompleted: done, inheritedDate } as ParsedNode, 1)) })
        expect(titles(task("call [scheduled:: 2026-10-14]"), "task")).toEqual(["Done", "Today", "Tomorrow", "Weekend", "Next Week", "Unschedule"])
        expect(panelItems(task("call ⏳ 2026-10-14")).find(i => i.title === "Unschedule")?.run).toEqual({ kind: "task", change: { kind: "unschedule" } })
        expect(titles(task("call", false, "2026-10-14"), "task")).toContain("Unschedule")
        expect(titles(task("call 📅 2026-10-14"), "task")).not.toContain("Unschedule")
        expect(titles(task("call [scheduled:: 2026-10-14]", true), "task")).toEqual([])
    })

    it("Edit: Edit on Alt+Enter, Rename and Delete where they apply", () => {
        expect(titles(ctx(), "edit")).toEqual(["Edit", "Delete"])
        expect(panelItems(ctx()).find(i => i.id === "edit")?.key).toMatchObject({ label: "Enter", alt: true })
        // A root page row: its own note renamed/trashed.
        expect(titles(ctx({ selectedPos: 0 }), "edit")).toEqual(["Edit", "Rename [[Project X]]", "Delete"])
    })

    it("a link-line page row renames its note", () => {
        const rows = rowsOf(row(page("New", "New.md"), 0), row(page("Project X", "Daily.md", 3), 1))
        const items = panelItems(ctx({ rows, selectedPos: 1 })).filter(i => i.section === "edit")
        expect(items.map(i => i.title)).toContain("Rename [[Project X]]")
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

    it("hides Edit and Edit search during a reparent chain", () => {
        expect(titles(ctx({ chainMode: "reparent" }), "edit")).not.toContain("Edit")
        expect(titles(ctx({ chainMode: "reparent", rowActions: [], selectedPos: -1 }), "edit")).toEqual([])
    })

    it("offers Edit search only outside the outline editor", () => {
        expect(titles(ctx({ outline: true, rowActions: [], selectedPos: -1 }), "edit")).toEqual([])
    })

    it("hides Append, Move under, Cut, the drawer, and filters in the outline editor", () => {
        const items = panelItems(ctx({ outline: true, drawerCount: 2, query: "foo is:task", filters: DEFAULT_SEARCH_FILTERS }))
        expect(items.map(i => i.id).filter(id => /^(append|moveUnder|cut|saveFilter)$|^(drawer|renameFilter|deleteFilter):/.test(id))).toEqual([])
        expect(items.filter(i => i.section === "edit").map(i => i.title)).toEqual(["Edit", "Delete"])
    })

    it("Cut: takes a cut row out of the drawer; hidden without editing and during a chain", () => {
        expect(titles(ctx({ rowCut: true }), "row")).toContain("Take out of drawer")
        expect(titles(ctx({ allowEditing: false }), "row")).not.toContain("Cut to drawer")
        expect(titles(ctx({ chainMode: "reparent" }), "row")).not.toContain("Cut to drawer")
    })

    it("Drawer: bulk actions over the cut items, only with editing and no chain", () => {
        expect(titles(ctx({ drawerCount: 2 }), "drawer")).toEqual(["Move 2 cut items under…", "Archive 2 cut items", "Clear drawer"])
        expect(titles(ctx({ drawerCount: 1 }), "drawer")[0]).toBe("Move 1 cut item under…")
        expect(titles(ctx({ drawerCount: 0 }), "drawer")).toEqual([])
        expect(titles(ctx({ drawerCount: 2, allowEditing: false }), "drawer")).toEqual([])
        expect(titles(ctx({ drawerCount: 2, chainMode: "reparent" }), "drawer")).toEqual([])
    })

    it("offers Edit for headings and attachments, not for the Archive row", () => {
        const h: ParsedNode = { ...base("Project X.md", 3), nodeType: "header", page: "Project X", header: "Plan", indent: 1 }
        const pdf: ParsedNode = { ...base("Project X.md", 5), nodeType: "attachment", name: "plan.pdf", extension: "pdf", aliases: [] }
        const rows = rowsOf(row(page("Project X", "Project X.md"), 0), row(h, 1), row(pdf, 1), row(text("old", "Project X.md", 9), 1, { archiveRow: true }))
        expect(titles(ctx({ rows, selectedPos: 1 }), "edit")).toContain("Edit")
        expect(titles(ctx({ rows, selectedPos: 2 }), "edit")).toContain("Edit")
        expect(titles(ctx({ rows, selectedPos: 3 }), "edit")).not.toContain("Edit")
    })

    it("Add to shows its own key", () => {
        expect(panelItems(ctx({addTo: "Add to loose"})).find(i => i.id === "addTo")?.key).toMatchObject({label: "A", alt: true})
    })

    it("Timeline: no Tree-only view items", () => {
        const tl = rowsOf(row(text("loose", "Project X.md", 7), 0, { timeline: { breadcrumb: [page("Project X", "Project X.md")], pinned: false, ageDays: 0 } }))
        const c = ctx({ rows: tl, selectedPos: 0, timelineActive: true })
        expect(titles(c, "edit")).toEqual(["Edit", "Delete"])
        expect(titles(c, "view")).toEqual(["Show tree", "Rebuild index"])
    })

    it("Filter: Save as Filter for a new query, Rename and Delete Filter for each active pill", () => {
        const c = ctx({ query: "foo is:task", filters: DEFAULT_SEARCH_FILTERS })
        expect(titles(c, "filter")).toEqual(["Save as Filter", 'Rename Filter "Tasks"', 'Delete Filter "Tasks"'])
        expect(panelItems(c).find(i => i.id === "renameFilter:Tasks")?.run).toEqual({ kind: "renameFilter", name: "Tasks" })
        expect(panelItems(c).find(i => i.id === "deleteFilter:Tasks")?.run).toEqual({ kind: "deleteFilter", name: "Tasks" })
    })

    it("Filter: no Save when the query is a saved filter's, ignoring whitespace", () => {
        expect(titles(ctx({ query: " is:task ", filters: DEFAULT_SEARCH_FILTERS }), "filter")).toEqual(['Rename Filter "Tasks"', 'Delete Filter "Tasks"'])
    })

    it("Filter: a :Name reference counts as the active pill and as the saved query", () => {
        expect(titles(ctx({ query: ":tasks foo", filters: DEFAULT_SEARCH_FILTERS }), "filter")).toEqual(["Save as Filter", 'Rename Filter "Tasks"', 'Delete Filter "Tasks"'])
        expect(titles(ctx({ query: " :Tasks ", filters: DEFAULT_SEARCH_FILTERS }), "filter")).toEqual(['Rename Filter "Tasks"', 'Delete Filter "Tasks"'])
    })

    it("Filter: nothing for a blank query", () => {
        expect(titles(ctx({ query: "", filters: DEFAULT_SEARCH_FILTERS }), "filter")).toEqual([])
    })

    it("Filter: nothing over a chain or in views without editor mode", () => {
        const over = { query: "is:task", filters: DEFAULT_SEARCH_FILTERS }
        expect(titles(ctx({ ...over, chainMode: "reparent" }), "filter")).toEqual([])
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

describe("filterPanelItems", () => {
    it("matches titles case-insensitively and keeps everything for a blank query", () => {
        const items = panelItems(ctx())
        expect(filterPanelItems(items, "ARCH").map(i => i.title)).toEqual(["Archive"])
        expect(filterPanelItems(items, "  ")).toHaveLength(items.length)
    })
})
