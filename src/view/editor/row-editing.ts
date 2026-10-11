// Pure row predicates and planning for editor mode (Append dot, Alt-Edit, drag-to-reparent).
// No obsidian imports: callers resolve file paths and line contents.

import {getKey, type ParsedNode} from "@mdtree/core"
import type {TreeNode} from "../search/SearchViewFlatten"
import type {DragReparentPlan} from "../../editing/vault-edits"

/** The file a node's page lives in (headers map to their page), an attachment's own file, or null for references and
 *  other nodes. */
export type OwnPath = (node: ParsedNode) => string | null

export type AppendTarget = { dotPos: number; parentName: string; target: TreeNode }

export const INLINE_LINK_REFUSAL = "Linked inline — edit the text to change its parent"

/** Rows whose line can be Alt-edited: text and headers, pages written as a link line in another file, and attachments
 *  (renamed). */
export function isEditableRow(row: TreeNode, ownPath: OwnPath, timeline: boolean): boolean {
    if (row.archiveRow) return false
    const node = row.node
    switch (node.nodeType) {
        case "text":
        case "header":
            return true
        case "page":
            return (row.indent > 0 || timeline) && node.location.path !== ownPath(node)
        case "attachment":
            return ownPath(node) === node.location.path
        default:
            return false
    }
}

/** What Delete removes for a row: a list line with its nested lines, a heading with its section, or a file (to the trash). */
export type DeleteTarget =
    | { kind: "line"; path: string; line: number }
    | { kind: "heading"; path: string; line: number }
    | { kind: "file"; path: string }

/** A page/header row written as a link line (`- [[Note]]`, `- [[Note#H]]`) in another file, not the note or heading itself. */
export function isLinkLineRow(row: TreeNode, ownPath: OwnPath, timeline: boolean): boolean {
    const node = row.node
    return (node.nodeType === "page" || node.nodeType === "header") && !row.archiveRow
        && (row.indent > 0 || timeline) && node.location.path !== ownPath(node)
}

export function deleteTargetOf(row: TreeNode, ownPath: OwnPath, timeline: boolean): DeleteTarget | null {
    if (row.archiveRow) return null
    const node = row.node
    const path = node.location.path
    const line = node.location.position.start.line
    switch (node.nodeType) {
        case "text":
            return {kind: "line", path, line}
        case "page":
            if (isLinkLineRow(row, ownPath, timeline)) return {kind: "line", path, line}
            return ownPath(node) === path ? {kind: "file", path} : null
        case "header":
            if (isLinkLineRow(row, ownPath, timeline)) return {kind: "line", path, line}
            return ownPath(node) === path ? {kind: "heading", path, line} : null
        case "attachment":
            return ownPath(node) === path ? {kind: "file", path} : null
        default:
            return null
    }
}

/** Nearest earlier row with a smaller indent. */
export function treeParentPos(rows: TreeNode[], pos: number): number | null {
    const indent = rows[pos].indent
    for (let i = pos - 1; i >= 0; i--) if (rows[i].indent < indent) return i
    return null
}

/** Last position of the group headed by `pos` (itself when it has no deeper rows after it). */
export function groupEnd(rows: TreeNode[], pos: number): number {
    const indent = rows[pos].indent
    let end = pos
    while (end + 1 < rows.length && rows[end + 1].indent > indent) end++
    return end
}

export function appendTargetAt(rows: TreeNode[], pos: number, timeline: boolean): AppendTarget | null {
    const row = rows[pos]
    if (!row || row.archiveRow) return null
    if (timeline) {
        const node = row.node
        let parentName: string | undefined
        if (node.nodeType === "page") parentName = node.page
        else {
            const crumb = [...(row.timeline?.breadcrumb ?? [])].reverse().find(n => n.nodeType === "page")
            if (crumb?.nodeType === "page") parentName = crumb.page
            else if (node.location.path) parentName = node.location.path.split("/").pop()!.replace(/\.md$/, "")
        }
        return parentName ? {dotPos: pos, parentName, target: row} : null
    }
    let minIndent = Infinity
    for (let i = pos; i >= 0; i--) {
        const r = rows[i]
        if (r.indent >= minIndent) continue
        minIndent = r.indent
        if (r.node.nodeType === "page" && !r.archiveRow) {
            return {dotPos: groupEnd(rows, i), parentName: r.node.page, target: r}
        }
    }
    // A header promoted to a root (its page didn't match) appends to its own page.
    if (row.node.nodeType === "header") return {dotPos: groupEnd(rows, pos), parentName: row.node.page, target: row}
    return null
}

export function dragInfo(rows: TreeNode[], pos: number): { draggable: boolean; refusal?: string } {
    const row = rows[pos]
    if (!row || row.timeline || row.archiveRow || row.indent === 0) return {draggable: false}
    const node = row.node
    if (node.nodeType !== "text" && node.nodeType !== "page") return {draggable: false}
    const parentPos = treeParentPos(rows, pos)
    if (parentPos === null || rows[parentPos].archiveRow) return {draggable: false}
    if (node.nodeType === "text") {
        const parent = rows[parentPos].node
        const linksParent = node.parsedTokens.some(t => {
            if (t.tokenType !== "obsidian_link" || t.embed) return false
            const target = t.pageTarget.toLowerCase()
            if (parent.nodeType === "page") return target === parent.page.toLowerCase()
            if (parent.nodeType === "header") {
                return target === parent.page.toLowerCase() && t.headerName?.toLowerCase() === parent.header.toLowerCase()
            }
            return false
        })
        if (linksParent) return {draggable: false, refusal: INLINE_LINK_REFUSAL}
    }
    return {draggable: true}
}

export function isValidDropTarget(rows: TreeNode[], dragPos: number, targetPos: number): boolean {
    const target = rows[targetPos]
    if (!target || target.archiveRow || target.node.nodeType !== "page") return false
    if (targetPos >= dragPos && targetPos <= groupEnd(rows, dragPos)) return false
    const key = getKey(target.node)
    if (key === getKey(rows[dragPos].node)) return false
    const parentPos = treeParentPos(rows, dragPos)
    return parentPos === null || key !== getKey(rows[parentPos].node)
}

/** How to move the dragged row under the target page. Bullet plans carry `head: ""`; the caller reads it from the file. */
export function classifyReparent(rows: TreeNode[], dragPos: number, targetPos: number, ownPath: OwnPath, relation: string): DragReparentPlan {
    const child = rows[dragPos].node
    const parentPos = treeParentPos(rows, dragPos)
    const target = rows[targetPos].node
    if (parentPos === null) throw new Error("Dragged row has no parent")
    if (target.nodeType !== "page") throw new Error("Drop target is not a page")
    const old = rows[parentPos].node
    const file = child.location.path
    const line = child.location.position.start.line
    if (child.nodeType === "page" && old.nodeType === "page" && ownPath(child) === file && line === 0) {
        return {kind: "frontmatter", childPath: file, oldName: old.page, newName: target.page, relation}
    }
    return ownPath(old) === file
        ? {kind: "cross-file", sourcePath: file, line, head: "", newName: target.page, stampDate: null}
        : {kind: "same-file", sourcePath: file, line, head: "", newName: target.page}
}
