// Items of the search views' action panel (footer "Actions", ⌘K, mobile long-press).
// Pure: callers pass the selected row's actions and the view's flags.

import type {TreeNode} from "./SearchViewFlatten"
import type {RaycastAction} from "../node-actions"
import {raycastActionOf} from "../node-actions"
import {SHORTCUTS, type KeySpec, type ShortcutId} from "./shortcuts"
import {appendTargetAt, dragInfo, isEditableRow, isValidDropTarget, type OwnPath} from "../editor/row-editing"
import type {TaskChange} from "../../editing/vault-edits"

export type PanelSection = "row" | "task" | "edit" | "view"

export type PanelIcon =
    | "link" | "reveal" | "copy" | "insert" | "moveToFolder" | "archive" | "consolidate"
    | "done" | "schedule"
    | "append" | "edit" | "moveUnder"
    | "openEditor" | "tree" | "timeline" | "expand" | "collapse" | "refresh"

export type PanelRun =
    | {kind: "shortcut"; id: ShortcutId}
    | {kind: "action"; action: RaycastAction}
    | {kind: "moveUnder"}
    | {kind: "task"; change: TaskChange}

export type PanelItem = {
    id: string
    section: PanelSection
    title: string
    icon: PanelIcon
    /** Shown as keycaps; the first key of the matching shortcut. */
    key?: KeySpec
    run: PanelRun
}

export type PanelContext = {
    /** The selected row's actions (`getTreeNodeActions`); empty when nothing is selected. */
    rowActions: RaycastAction[]
    rows: TreeNode[]
    /** Position of the selected row in `rows`, or -1. */
    selectedPos: number
    allowEditing: boolean
    allowTimeline: boolean
    timelineActive: boolean
    ownPath: OwnPath
}

export const SECTION_TITLES: Record<Exclude<PanelSection, "row">, string> = {task: "Task", edit: "Edit", view: "View"}

const keyOf = (id: ShortcutId): KeySpec | undefined => SHORTCUTS.find(s => s.id === id)?.keys[0]

/** The shortcut that runs the same thing as a row action, and the icon that goes with it. */
function rowActionShortcut(action: RaycastAction): {id?: ShortcutId; icon: PanelIcon} {
    const sc = action.shortcut
    if (sc?.key === "enter" && sc.modifiers.length === 0) return {id: "open", icon: "link"}
    if (sc?.key === "enter" && sc.modifiers.includes("shift")) return {id: "reveal", icon: "reveal"}
    if (action.type === "copy") return {id: "copy", icon: "copy"}
    switch (raycastActionOf(action)) {
        case "insert": return {id: "insertAfter", icon: "insert"}
        case "moveToFolder": return {id: "moveTo", icon: "moveToFolder"}
        case "archive": case "unarchive": case "archivePage": case "unarchivePage": return {id: "archive", icon: "archive"}
        case "pullChildren": return {id: "consolidate", icon: "consolidate"}
    }
    return {icon: "link"}
}

/** Rows the selected row can be moved under: the same rule as a drop (Tree mode only). */
export function moveUnderTargets(rows: TreeNode[], pos: number): number[] {
    if (pos < 0 || !dragInfo(rows, pos).draggable) return []
    const targets: number[] = []
    for (let t = 0; t < rows.length; t++) if (isValidDropTarget(rows, pos, t)) targets.push(t)
    return targets
}

export function panelItems(ctx: PanelContext): PanelItem[] {
    const items: PanelItem[] = []
    const row = ctx.selectedPos >= 0 ? ctx.rows[ctx.selectedPos] : undefined

    ctx.rowActions.forEach((action, i) => {
        // With editor mode, Insert after opens Append, which the Edit section already offers.
        if (ctx.allowEditing && raycastActionOf(action) === "insert") return
        const {id, icon} = rowActionShortcut(action)
        items.push({id: `row:${i}`, section: "row", title: action.title, icon, key: id && keyOf(id), run: {kind: "action", action}})
    })

    // Open tasks: complete or reschedule the line (Tasks plugin fields), in every view like Archive.
    if (row && row.node.nodeType === "text" && row.node.isTask && !row.node.isCompleted) {
        const task = (id: string, title: string, icon: PanelIcon, change: TaskChange) =>
            items.push({id: `task:${id}`, section: "task", title, icon, run: {kind: "task", change}})
        task("done", "Done", "done", {kind: "done", done: true})
        task("today", "Today", "schedule", {kind: "schedule", when: "today"})
        task("tomorrow", "Tomorrow", "schedule", {kind: "schedule", when: "tomorrow"})
        task("weekend", "Weekend", "schedule", {kind: "schedule", when: "weekend"})
        task("nextWeek", "Next Week", "schedule", {kind: "schedule", when: "nextWeek"})
    }

    if (ctx.allowEditing && row) {
        const target = appendTargetAt(ctx.rows, ctx.selectedPos, ctx.timelineActive)
        if (target) items.push({id: "append", section: "edit", title: `Append to [[${target.parentName}]]`, icon: "append", key: keyOf("append"), run: {kind: "shortcut", id: "append"}})
        if (isEditableRow(row, ctx.ownPath, ctx.timelineActive)) items.push({id: "edit", section: "edit", title: "Edit line", icon: "edit", key: keyOf("edit"), run: {kind: "shortcut", id: "edit"}})
        if (!ctx.timelineActive && moveUnderTargets(ctx.rows, ctx.selectedPos).length > 0) {
            items.push({id: "moveUnder", section: "edit", title: "Move under…", icon: "moveUnder", run: {kind: "moveUnder"}})
        }
    }

    const view = (id: ShortcutId, title: string, icon: PanelIcon) =>
        items.push({id, section: "view", title, icon, key: keyOf(id), run: {kind: "shortcut", id}})
    if (ctx.allowEditing) view("newEditor", "Open editor", "openEditor")
    if (ctx.allowTimeline) view("toggleView", ctx.timelineActive ? "Show tree" : "Show timeline", ctx.timelineActive ? "tree" : "timeline")
    if (!ctx.timelineActive) {
        view("expand", "Expand one level", "expand")
        view("collapse", "Collapse one level", "collapse")
        view("collapseAll", "Collapse all", "collapse")
    }
    view("refresh", "Rebuild index", "refresh")
    return items
}

/** Items whose title contains `query` (case-insensitive); all items for a blank query. */
export function filterPanelItems<T extends {title: string}>(items: T[], query: string): T[] {
    const q = query.trim().toLowerCase()
    return q ? items.filter(it => it.title.toLowerCase().includes(q)) : items
}
