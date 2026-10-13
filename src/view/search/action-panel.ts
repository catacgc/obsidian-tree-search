// Items of the search views' action panel (footer "Actions", ⌘K, mobile long-press).
// Pure: callers pass the selected row's actions and the view's flags.

import {hasScheduledDate} from "@mdtree/core"
import type {TreeNode} from "./SearchViewFlatten"
import type {RaycastAction} from "../node-actions"
import {raycastActionOf} from "../node-actions"
import {SHORTCUTS, type KeySpec, type ShortcutId} from "./shortcuts"
import {
    appendTargetAt, deleteTargetOf, isEditableRow, isLinkLineRow, type DeleteTarget, type OwnPath,
} from "../editor/row-editing"
import {isMovable, isPatchable} from "./chain"
import type {TaskChange} from "../../editing/vault-edits"
import type {SearchFilter} from "../react-context/settings"
import {filterActive, sameFilterQuery} from "./search-filter"

export type PanelSection = "row" | "task" | "edit" | "drawer" | "filter" | "view"

export type PanelIcon =
    | "link" | "reveal" | "copy" | "insert" | "archive" | "consolidate"
    | "done" | "schedule" | "unschedule"
    | "append" | "edit" | "moveUnder" | "cut" | "patch" | "rename" | "delete"
    | "clearDrawer"
    | "saveFilter" | "deleteFilter"
    | "quickAdd" | "tree" | "timeline" | "expand" | "collapse" | "refresh"

export type PanelRun =
    | {kind: "shortcut"; id: ShortcutId}
    | {kind: "action"; action: RaycastAction}
    | {kind: "task"; change: TaskChange}
    | {kind: "patch"}
    | {kind: "renameFile"; path: string}
    | {kind: "delete"}
    | {kind: "saveFilter"}
    | {kind: "deleteFilter"; name: string}
    | {kind: "drawer"; op: "move" | "archive" | "clear"}

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
    /** The view's append-chain mode (`chainAtom`), or null with no chain. */
    chainMode: "append" | "reparent" | null
    resolveLink: ResolveLink
    /** The search query (actualQueryAtom). */
    query: string
    /** The filter pills (searchFiltersAtom). */
    filters: readonly SearchFilter[]
    /** The selected row is in the cut drawer. */
    rowCut: boolean
    /** Items in the cut drawer. */
    drawerCount: number
}

/** The vault path of the file `linkpath` resolves to from `sourcePath`, or null. */
export type ResolveLink = (linkpath: string, sourcePath: string) => string | null

export type RenameTarget = {path: string; title: string}

const fileNameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1)
const noteName = (path: string): string => fileNameOf(path).replace(/\.md$/i, "")

/** Files a row can rename through a vault rename: a page row's own note; a header link line's note; a text row's
 *  resolved [[links]] and ![[embeds]] in line order, once per file. */
export function renameTargets(row: TreeNode, ownPath: OwnPath, resolveLink: ResolveLink, timeline: boolean): RenameTarget[] {
    if (row.archiveRow) return []
    const node = row.node
    if (node.nodeType === "page" || (node.nodeType === "header" && isLinkLineRow(row, ownPath, timeline))) {
        const p = ownPath(node)
        return p ? [{path: p, title: `Rename [[${noteName(p)}]]`}] : []
    }
    if (node.nodeType !== "text") return []
    const out: RenameTarget[] = []
    for (const t of node.parsedTokens) {
        if (t.tokenType !== "obsidian_link") continue
        // Parsed from `source`: the parser's pageTarget drops folder paths.
        const linkpath = t.source.slice(2, -2).split("|")[0].split("#")[0].trim()
        if (!linkpath) continue
        const path = resolveLink(linkpath, node.location.path)
        if (path === null || out.some(r => r.path === path)) continue
        const display = /\.md$/i.test(path) ? noteName(path) : fileNameOf(path)
        out.push({path, title: t.embed ? `Rename ![[${display}]]` : `Rename [[${display}]]`})
    }
    return out
}

/** The Delete confirmation page's title and confirm action for `target`; `label` names the row. */
export function deleteConfirmText(target: DeleteTarget, label: string): {title: string; action: string} {
    switch (target.kind) {
        case "line":
            return {title: `Delete "${label}" and everything nested under it?`, action: "Delete"}
        case "heading":
            return {title: `Delete heading "${label}" and its section?`, action: "Delete"}
        case "file":
            return {title: `Move "${fileNameOf(target.path)}" to trash?`, action: "Move to trash"}
    }
}

export const SECTION_TITLES: Record<Exclude<PanelSection, "row">, string> = {task: "Task", edit: "Edit", drawer: "Drawer", filter: "Filter", view: "View"}

const keyOf = (id: ShortcutId): KeySpec | undefined => SHORTCUTS.find(s => s.id === id)?.keys[0]

/** The shortcut that runs the same thing as a row action, and the icon that goes with it. */
function rowActionShortcut(action: RaycastAction): {id?: ShortcutId; icon: PanelIcon} {
    const sc = action.shortcut
    if (sc?.key === "enter" && sc.modifiers.length === 0) return {id: "open", icon: "link"}
    if (sc?.key === "enter" && sc.modifiers.includes("shift")) return {id: "reveal", icon: "reveal"}
    if (action.type === "copy") return {id: "copy", icon: "copy"}
    switch (raycastActionOf(action)) {
        case "insert": return {id: "insertAfter", icon: "insert"}
        case "archive": case "unarchive": case "archivePage": case "unarchivePage": return {id: "archive", icon: "archive"}
        case "pullChildren": return {id: "consolidate", icon: "consolidate"}
    }
    return {icon: "link"}
}

export function panelItems(ctx: PanelContext): PanelItem[] {
    const items: PanelItem[] = []
    const row = ctx.selectedPos >= 0 ? ctx.rows[ctx.selectedPos] : undefined

    ctx.rowActions.forEach((action, i) => {
        // Move To (folder picker) is replaced by Move under… below. With editor mode, Insert after opens Append, which
        // the Edit section already offers.
        if (raycastActionOf(action) === "moveToFolder") return
        if (ctx.allowEditing && raycastActionOf(action) === "insert") return
        const {id, icon} = rowActionShortcut(action)
        items.push({id: `row:${i}`, section: "row", title: action.title, icon, key: id && keyOf(id), run: {kind: "action", action}})
    })
    // Move under…: the `<` flow (search for the new parent), for every row it can move.
    if (row && !row.archiveRow && isMovable(row.node)) {
        items.push({id: "moveUnder", section: "row", title: "Move under…", icon: "moveUnder", key: keyOf("moveUnder"), run: {kind: "shortcut", id: "moveUnder"}})
    }
    // Cut (⌘X): into the cut drawer, or out of it; not over a chain.
    if (ctx.allowEditing && row && !row.archiveRow && isMovable(row.node) && ctx.chainMode === null) {
        items.push({id: "cut", section: "row", title: ctx.rowCut ? "Take out of drawer" : "Cut to drawer", icon: "cut", key: keyOf("cut"), run: {kind: "shortcut", id: "cut"}})
    }

    // Open tasks: complete, reschedule or unschedule the line (Tasks plugin fields), in every view like Archive.
    if (row && row.node.nodeType === "text" && row.node.isTask && !row.node.isCompleted) {
        const task = (id: string, title: string, icon: PanelIcon, change: TaskChange) =>
            items.push({id: `task:${id}`, section: "task", title, icon, run: {kind: "task", change}})
        task("done", "Done", "done", {kind: "done", done: true})
        task("today", "Today", "schedule", {kind: "schedule", when: "today"})
        task("tomorrow", "Tomorrow", "schedule", {kind: "schedule", when: "tomorrow"})
        task("weekend", "Weekend", "schedule", {kind: "schedule", when: "weekend"})
        task("nextWeek", "Next Week", "schedule", {kind: "schedule", when: "nextWeek"})
        // The line's own scheduled date, or one it shows from an open subtask (Unschedule clears those too).
        if (hasScheduledDate(row.node.searchKey) || row.node.inheritedDate !== undefined) task("unschedule", "Unschedule", "unschedule", {kind: "unschedule"})
    }

    if (ctx.allowEditing && row) {
        const target = appendTargetAt(ctx.rows, ctx.selectedPos, ctx.timelineActive)
        if (target) items.push({id: "append", section: "edit", title: `Append to [[${target.parentName}]]`, icon: "append", key: keyOf("append"), run: {kind: "shortcut", id: "append"}})
        const type = row.node.nodeType
        // Patch: what typing `>` does (`>` is typed text, not a shortcut).
        if (!row.archiveRow && ctx.chainMode !== "reparent" && isPatchable(row.node)) {
            items.push({id: "patch", section: "edit", title: "Patch", icon: "patch", run: {kind: "patch"}})
        }
        if (isEditableRow(row, ctx.ownPath, ctx.timelineActive) && !isLinkLineRow(row, ctx.ownPath, ctx.timelineActive)) {
            const rename = type === "header" || type === "attachment"
            items.push({id: "edit", section: "edit", title: rename ? "Rename" : "Edit line", icon: "edit", key: keyOf("edit"), run: {kind: "shortcut", id: "edit"}})
        }
        for (const t of renameTargets(row, ctx.ownPath, ctx.resolveLink, ctx.timelineActive)) {
            items.push({id: `rename:${t.path}`, section: "edit", title: t.title, icon: "rename", run: {kind: "renameFile", path: t.path}})
        }
        if (deleteTargetOf(row, ctx.ownPath, ctx.timelineActive)) {
            items.push({id: "delete", section: "edit", title: "Delete", icon: "delete", run: {kind: "delete"}})
        }
    }

    // The cut drawer's bulk actions.
    if (ctx.allowEditing && ctx.drawerCount > 0 && ctx.chainMode === null) {
        const n = ctx.drawerCount
        const cut = `${n} cut item${n === 1 ? "" : "s"}`
        items.push({id: "drawer:move", section: "drawer", title: `Move ${cut} under…`, icon: "moveUnder", run: {kind: "drawer", op: "move"}})
        items.push({id: "drawer:archive", section: "drawer", title: `Archive ${cut}`, icon: "archive", run: {kind: "drawer", op: "archive"}})
        items.push({id: "drawer:clear", section: "drawer", title: "Clear drawer", icon: "clearDrawer", run: {kind: "drawer", op: "clear"}})
    }

    // Filter pills (Search modal and pane, which show the filter bar and the editor); not over a chain's sub-search.
    if (ctx.allowEditing && ctx.allowTimeline && ctx.chainMode === null) {
        if (ctx.query.trim() !== "" && !ctx.filters.some(f => sameFilterQuery(f.query, ctx.query) || ctx.query.trim().toLowerCase() === `:${f.name.toLowerCase()}`)) {
            items.push({id: "saveFilter", section: "filter", title: "Save as Filter", icon: "saveFilter", run: {kind: "saveFilter"}})
        }
        for (const f of ctx.filters) {
            if (filterActive(ctx.query, f)) items.push({id: `deleteFilter:${f.name}`, section: "filter", title: `Delete Filter "${f.name}"`, icon: "deleteFilter", run: {kind: "deleteFilter", name: f.name}})
        }
    }

    const view = (id: ShortcutId, title: string, icon: PanelIcon) =>
        items.push({id, section: "view", title, icon, key: keyOf(id), run: {kind: "shortcut", id}})
    if (ctx.allowEditing) view("quickAdd", "Quick Add", "quickAdd")
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
