// What Enter, or a click on the selected row, does to a result row in Search views. Pure: openRowAtom runs the intent,
// ActionFooter names it.
import {advancedSearch, getKey, type NotesGraph, type ParsedNode} from "@mdtree/core"
import type {Browse} from "../node-actions"
import {isPatchable, rowLabel} from "./chain"

export type RowIntent =
    /** A plain leaf text row's source-line editor. */
    | {kind: "edit"}
    /** The outline on the row's tree (inside an existing outline: one level deeper). */
    | {kind: "explore"}
    | {kind: "browse"; action: Browse}
    | {kind: "toggleTask"; done: boolean}
    | {kind: "copy"; text: string}
    /** The row's own plain-Enter action, if it has one (folders, months, attachments). */
    | {kind: "default"}

export type RowIntentContext = {
    /** Enter, or a click on the already selected row. */
    via: "key" | "pointer"
    /** Exploring the row would list rows under it (hasExploreRows). */
    hasChildren: boolean
    /** The line's web URL action (webEnterAction). */
    web: Browse | null
}

/** Notes and headings are explored, as is any line a click opens. For Enter on a line: its web URL opens; a line with
 *  children is explored; a leaf task toggles, a leaf line with a snippet copies it, and any other leaf line is edited. */
export function rowIntent(node: ParsedNode, ctx: RowIntentContext): RowIntent {
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
