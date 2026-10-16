// What Enter, or a click on the selected row, does to a result row in views with editor mode (the Search modal and
// pane). Pure: openRowAtom runs the intent, ActionFooter names it.
import {advancedSearch, getKey, type NotesGraph, type ParsedNode} from "@mdtree/core"
import type {Browse} from "../node-actions"
import {isPatchable, rowLabel} from "./chain"
import type {OutlineMode} from "./outline"

export type RowIntent =
    /** The line editor on the row (a note's own row: its content pane; an attachment: Rename). */
    | {kind: "edit"}
    /** The outline on the row's tree, in explore mode (inside an outline: one level deeper). */
    | {kind: "explore"}
    | {kind: "browse"; action: Browse}
    | {kind: "toggleTask"; done: boolean}
    | {kind: "copy"; text: string}
    /** The row's own plain-Enter action, if it has one (folders, months, attachments). */
    | {kind: "default"}

export type RowIntentContext = {
    /** The open outline's mode; null for the plain search. */
    mode: OutlineMode | null
    /** Enter, or a click on the already selected row. */
    via: "key" | "pointer"
    /** Exploring the row would list rows under it (hasExploreRows). */
    hasChildren: boolean
    /** The line's web URL action (webEnterAction). */
    web: Browse | null
}

/** Edit mode edits every note, heading and line. Otherwise notes and headings are explored, and so is any line a
 *  click opens. For Enter on a line: its web URL opens; a line with children is explored; a leaf task toggles, a leaf
 *  line with a snippet copies it, and any other leaf line is edited. */
export function rowIntent(node: ParsedNode, ctx: RowIntentContext): RowIntent {
    if (ctx.mode === "edit") return isPatchable(node) || node.nodeType === "attachment" ? {kind: "edit"} : {kind: "default"}
    if (!isPatchable(node)) return {kind: "default"}
    if (node.nodeType !== "text" || ctx.via === "pointer") return {kind: "explore"}
    if (ctx.web) return {kind: "browse", action: ctx.web}
    if (ctx.hasChildren) return {kind: "explore"}
    if (node.isTask) return {kind: "toggleTask", done: !node.isCompleted}
    const snippet = snippetOf(node)
    return snippet === null ? {kind: "edit"} : {kind: "copy", text: snippet}
}

/** A line's first code span (`` `like this` ``), trimmed; null for none or for another kind of row. */
export function snippetOf(node: ParsedNode): string | null {
    if (node.nodeType !== "text") return null
    for (const t of node.parsedTokens) {
        if (t.tokenType === "text" && t.decoration === "code" && t.text.trim() !== "") return t.text.trim()
    }
    return null
}

/** The footer's name for Enter's intent on `node`; null for `default` (the row's own plain-Enter action names it). */
export function intentLabel(intent: RowIntent, node: ParsedNode): string | null {
    switch (intent.kind) {
        case "edit": return `Edit ${rowLabel(node)}`
        case "explore": return `Explore ${rowLabel(node)}`
        case "browse": return intent.action.title
        case "toggleTask": return intent.done ? "Complete task" : "Reopen task"
        case "copy": return `Copy ${intent.text.length > 40 ? intent.text.slice(0, 39) + "…" : intent.text}`
        case "default": return null
    }
}

/** Exploring `node` would list rows under it: its tree as the outline lists it (refreshOutlineResultsAtom) isn't empty. */
export function hasExploreRows(graph: NotesGraph, node: ParsedNode, separator: string): boolean {
    return advancedSearch(graph, getKey(node), "", separator).length > 0
}
