import { describe, it, expect } from "bun:test"
import type { ParsedNode } from "@mdtree/core"
import type { TreeNode } from "../view/search/SearchViewFlatten"
import type { RaycastAction } from "../view/node-actions"
import type { OwnPath } from "../view/editor/row-editing"
import { filterPanelItems, moveUnderTargets, panelItems, type PanelContext } from "../view/search/action-panel"

const loc = (path: string, line: number) => ({ path, position: { start: { line, ch: 0 }, end: { line, ch: 0 } } })
const base = (path: string, line: number) => ({ searchKey: "", location: loc(path, line), boost: 0, ageDays: 0 })
const page = (name: string, path: string, line = 0): ParsedNode =>
    ({ ...base(path, line), nodeType: "page", isReference: false, page: name, aliases: [], tags: [] })
const text = (key: string, path: string, line: number): ParsedNode =>
    ({ ...base(path, line), searchKey: key, nodeType: "text", parsedTokens: [], tags: [], isTask: false, isCompleted: false })
const row = (node: ParsedNode, indent: number, extra: Partial<TreeNode> = {}): TreeNode =>
    ({ node, indent, hasChildren: false, visible: true, selected: false, index: 0, matched: true, ...extra })
const rowsOf = (...rs: TreeNode[]) => rs.map((r, i) => ({ ...r, index: i }))

const OWN: Record<string, string> = { "project x": "Project X.md", "new": "New.md" }
const ownPath: OwnPath = n => n.nodeType === "page" ? OWN[n.page.toLowerCase()] ?? null : null

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
    allowEditing: true, allowTimeline: true, timelineActive: false, ownPath, ...over,
})
const titles = (c: PanelContext, section?: string) => panelItems(c).filter(i => !section || i.section === section).map(i => i.title)

describe("panelItems", () => {
    it("lists only the View section when no row is selected", () => {
        const items = panelItems(ctx({ rowActions: [], selectedPos: -1 }))
        expect(new Set(items.map(i => i.section))).toEqual(new Set(["view"]))
        expect(items.map(i => i.title)).toEqual(["Open editor", "Show timeline", "Expand one level", "Collapse one level", "Collapse all", "Rebuild index"])
    })

    it("maps row actions to their shortcut keys and drops Insert after when Append exists", () => {
        const row = panelItems(ctx()).filter(i => i.section === "row")
        expect(row.map(i => i.title)).toEqual(["Browse example", "See in Obsidian", "Copy Node", "Archive"])
        expect(row.map(i => i.key?.label)).toEqual(["Enter", "Enter", "C", "X"])
        expect(row[1].key?.shift).toBe(true)
    })

    it("keeps Insert after in views without editor mode, which also have no Edit section", () => {
        const c = ctx({ allowEditing: false, allowTimeline: false })
        expect(titles(c, "row")).toContain("Insert After")
        expect(titles(c, "edit")).toEqual([])
        expect(titles(c, "view")).not.toContain("Open editor")
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

    it("Edit: Append to names the target page; Edit line and Move under only where they apply", () => {
        expect(titles(ctx(), "edit")).toEqual(["Append to [[Project X]]", "Edit line", "Move under…"])
        // A root page row: appendable, not editable (its own file), not draggable.
        expect(titles(ctx({ selectedPos: 0 }), "edit")).toEqual(["Append to [[Project X]]"])
    })

    it("Append shows its own key", () => {
        const append = (c: PanelContext) => panelItems(c).find(i => i.id === "append")
        expect(append(ctx())?.key?.label).toBe("A")
    })

    it("Timeline: no Move under and no Tree-only view items", () => {
        const tl = rowsOf(row(text("loose", "Project X.md", 7), 0, { timeline: { breadcrumb: [page("Project X", "Project X.md")], pinned: false, ageDays: 0 } }))
        const c = ctx({ rows: tl, selectedPos: 0, timelineActive: true })
        expect(titles(c, "edit")).toEqual(["Append to [[Project X]]", "Edit line"])
        expect(titles(c, "view")).toEqual(["Open editor", "Show tree", "Rebuild index"])
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
