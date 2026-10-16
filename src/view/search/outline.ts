// The outline editor (docs/superpowers/specs/2026-10-15-outline-editor-design.md), pure parts: its state, crumbs,
// pins and the line editor's field. The atoms in state.tsx / EditorMolecule.ts run it.
import {getKey, parseOutline, type NotesGraph, type OutlineLine, type ParsedNode} from "@mdtree/core"
import type {EditorAttachment} from "../../editing/vault-edits"
import type {RowTarget} from "./select-target"
import type {TreeNode} from "./SearchViewFlatten"
import {rowLabel} from "./chain"

/** What openOutlineAtom opens on: search, Today (with a New line, optionally prefilled for Quick Add), a result row (default: selected), or a note/heading link (`Name`, `Name#Heading`). */
export type OutlineTarget =
    | {kind: "search"}
    | {kind: "today"; prefill?: string; quickAdd?: boolean}
    | {kind: "row"; row?: TreeNode}
    | {kind: "link"; link: string}

let lineEditIds = 0
/** A fresh LineEdit id (a new line editor remounts its field). */
export const nextLineEditId = (): number => ++lineEditIds

/** A path crumb: today's daily note, or a page, heading or line. */
export type OutlineRoot = {kind: "today"} | {kind: "node"; node: ParsedNode; label: string}

/** A line edited or added in this outline session: listed even when a filter would hide it. */
export type OutlinePin = {path: string; line: number}

export type OutlineState = {
    /** Path crumbs, top-down; the last is the root. Empty: the search root (the results of `prevQuery`). */
    path: OutlineRoot[]
    /** Filter crumbs (queries, ANDed), after the path crumbs. */
    filters: string[]
    /** The search query typed before the outline editor opened; restored on leaving it. */
    prevQuery: string
    /** The row selected when it opened, reselected on leaving it. */
    returnTo: RowTarget[]
    /** Opened by Quick Add: titled Quick Add while its root is Today. */
    quickAdd: boolean
    pins: OutlinePin[]
}

/** The edited row of a line editor, as read when it opened. */
export type LineEditRow = {
    node: ParsedNode
    path: string
    line: number
    /** The whole line as read from the file. */
    expectedLine: string
    heading: boolean
    /** A nested text line (TextNode.nested): no default schedule. */
    nested: boolean
}

export type LineEdit = {
    id: number
    /** The edited row; null for the New line row, which writes under the root (newLineTarget). */
    row: LineEditRow | null
    /** The line's indent, bullet and checkbox, or a heading's `#… `, kept outside the field (a New line: its
     *  bullet). */
    prefix: string
    /** The field: the row's text without its prefix, then the added lines as an outline (depth 0 = the row's depth). */
    text: string
    /** The field as opened: a different `text` is unsaved. */
    initial: string
    caret: number
    /** Files pasted into the field, renamed by alias on save and trashed on discard. */
    attachments: EditorAttachment[]
    saving: boolean
}

/** Where the New line row writes for a root: today's daily note (under `- [[parentName]]` for a note or heading
 *  root), or as the last children of a line root. */
export function newLineTarget(root: OutlineRoot | null): {kind: "daily"; parentName?: string} | {kind: "under"; node: ParsedNode} {
    if (root === null || root.kind === "today") return {kind: "daily"}
    const n = root.node
    if (n.nodeType === "page") return {kind: "daily", parentName: n.page}
    if (n.nodeType === "header") return {kind: "daily", parentName: `${n.page}#${n.header}`}
    return {kind: "under", node: n}
}

/** The content pane's size, and the key of the buffer it was closed on (it stays hidden until another is shown). */
export type PaneState = {size: "normal" | "expanded" | "collapsed"; closedKey: string | null}

export const TODAY_LABEL = "Today"

/** The root: the last path crumb, or null for the search root. */
export function rootOf(o: OutlineState): OutlineRoot | null {
    return o.path[o.path.length - 1] ?? null
}

/** The graph key whose tree a root lists (advancedSearch). */
export function rootKey(root: OutlineRoot, dailyName: string): string {
    return root.kind === "today" ? `[[${dailyName.toLowerCase()}]]` : getKey(root.node)
}

/** Identity of a path crumb: the same note, heading or line (or today) has the same key. */
export function crumbKey(root: OutlineRoot, dailyName: string): string {
    return root.kind === "node" && root.node.nodeType === "text"
        ? `line:${root.node.location.path}:${root.node.location.position.start.line}`
        : rootKey(root, dailyName)
}

export function rootLabel(root: OutlineRoot): string {
    return root.kind === "today" ? TODAY_LABEL : root.label
}

/** The crumb for a node: Today for today's daily note's page, else the node with its row label. */
export function rootFor(node: ParsedNode, dailyName: string): OutlineRoot {
    if (node.nodeType === "page" && node.page.toLowerCase() === dailyName.toLowerCase()) return {kind: "today"}
    return {kind: "node", node, label: rowLabel(node)}
}

/** `path` with `added` after it, minus an added crumb that repeats the one before it. */
export function extendPath(path: OutlineRoot[], added: OutlineRoot[], dailyName: string): OutlineRoot[] {
    const out = [...path]
    for (const r of added) {
        const last = out[out.length - 1]
        if (last && crumbKey(last, dailyName) === crumbKey(r, dailyName)) continue
        out.push(r)
    }
    return out
}

/** The crumbs for a link with no row shown: `Note`, or `Note › Heading` when the heading is indexed; null when the
 *  note isn't in the graph. */
export function linkCrumbs(graph: NotesGraph, page: string, heading: string | undefined, dailyName: string): OutlineRoot[] | null {
    const key = `[[${page.toLowerCase()}]]`
    if (!graph.hasNode(key)) return null
    const crumbs = [rootFor(graph.getNodeAttributes(key), dailyName)]
    const headingKey = heading ? `${page}#${heading}`.toLowerCase() : null
    if (headingKey && graph.hasNode(headingKey)) crumbs.push(rootFor(graph.getNodeAttributes(headingKey), dailyName))
    return crumbs
}

/** The Search modal title for an outline session: Quick Add at Today, `Explore "<query>"` at the search root, else `Explore <root>`. */
export function outlineTitle(o: OutlineState): string {
    const root = rootOf(o)
    if (root === null) return o.prevQuery.trim() ? `Explore "${o.prevQuery.trim()}"` : "Explore search"
    if (o.quickAdd && root.kind === "today") return "Quick Add"
    return `Explore ${rootLabel(root)}`
}

/** The New line row's label: `Add to <root>` (the search root writes to today's daily note: `Add to Today`). */
export function newLineLabel(o: OutlineState): string {
    const root = rootOf(o)
    return `Add to ${root === null ? TODAY_LABEL : rootLabel(root)}`
}

export const isPinned = (pins: readonly OutlinePin[], node: ParsedNode): boolean =>
    pins.some(p => p.path === node.location.path && p.line === node.location.position.start.line)

/** `pins` after a write to `path` inserted the blocks `inserted` (line numbers in the written file, ascending), plus
 *  `added` (lines of the written file). */
export function shiftPins(pins: readonly OutlinePin[], path: string, inserted: readonly {at: number; count: number}[], added: number[]): OutlinePin[] {
    const shifted = pins.map(p => {
        if (p.path !== path) return p
        let line = p.line
        for (const b of inserted) if (line >= b.at) line += b.count
        return {path, line}
    })
    for (const line of added) if (!shifted.some(p => p.path === path && p.line === line)) shifted.push({path, line})
    return shifted
}

/** The line editor's field as the first line's text and the added lines (depths relative to the edited line). Blank
 *  added lines are dropped. */
export function fieldLines(text: string): {first: string; extra: OutlineLine[]} {
    const nl = text.indexOf("\n")
    const first = (nl < 0 ? text : text.slice(0, nl)).trim()
    const extra = nl < 0 ? [] : parseOutline("- x\n" + text.slice(nl + 1)).lines.slice(1)
    return {first, extra}
}

/** The field's lines as raw markdown lines with their depth (0 = the edited line), null for blank lines: the first
 *  with the row's `prefix` (a New line: `- `), the others as written. For lineNode / blockMisses. */
export function fieldRawLines(text: string, prefix: string): ({raw: string; depth: number} | null)[] {
    const lines = text.split("\n")
    let prev = 0
    return lines.map((l, i) => {
        if (i === 0) return {raw: prefix.trimStart() + l.trim(), depth: 0}
        if (l.trim() === "") return null
        const width = l.replace(/\t/g, "    ").length - l.replace(/\t/g, "    ").trimStart().length
        const depth = Math.min(Math.floor(width / 4), prev + 1)
        prev = depth
        return {raw: l.trimStart(), depth}
    })
}
