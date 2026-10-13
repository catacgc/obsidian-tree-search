import type { App, TFile } from "obsidian"
import { buildTimeline, fileParent, isUnscheduledTask, outlineContext, type NotesGraph, type ParsedNode, type QueryExpr, type ResultNode } from "@mdtree/core"
import type { TreeNode } from "./SearchViewFlatten"

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]

// Drop the annotations that repeat the row's date from a text line's plain
// text tokens: bare `date` occurrences and inline fields holding only that date
// (`[scheduled:: date]`, `(due:: date)`). Other dates carry information and stay.
// An unscheduled task shows no date (rowDate): its field (`[created:: date]`) still
// goes, but a bare date stays in its text.
export function stripDateAnnotations(node: ParsedNode, date: string): ParsedNode {
    if (node.nodeType !== "text") return node
    const field = String.raw`[\[(][^\[\]()]*::\s*${date}\s*[\])]`
    const re = new RegExp(String.raw`\s*(?:${isUnscheduledTask(node) ? field : `${field}|${date}`})`, "g")
    return {
        ...node,
        parsedTokens: node.parsedTokens.map(t => t.tokenType === "text" ? { ...t, text: t.text.replace(re, "") } : t),
    }
}

// Plain-text label of a node, used for breadcrumb segments.
export function nodeLabel(node: ParsedNode): string {
    switch (node.nodeType) {
        case "page": return node.page
        case "header": return node.header
        case "folder": return node.name || node.path
        case "folderNote": return node.folder.name
        case "attachment": return node.name
        case "month": return `${node.monthLiteral} ${node.year}`
        case "pointer": return ""
        case "text": {
            let out = ""
            for (const t of node.parsedTokens) {
                switch (t.tokenType) {
                    case "text": out += t.text; break
                    case "obsidian_link": out += (t.alias && !parseInt(t.alias)) ? t.alias : t.pageTarget; break
                    case "link": out += t.content ?? t.href; break
                    case "image": out += t.alt || ""; break
                }
            }
            return out.trim()
        }
    }
}

// Basename (without extension) of the note a line lives in; breadcrumb
// fallback when no ancestor matched the query.
export function sourceNoteLabel(node: ParsedNode): string | null {
    switch (node.nodeType) {
        case "page":
        case "folder":
        case "folderNote":
        case "attachment":
            return null
    }
    const path = node.location.path
    if (!path) return null
    return path.split("/").pop()!.replace(/\.[^.]+$/, "")
}

function safeDecode(s: string): string {
    try {
        return decodeURIComponent(s)
    } catch {
        return s
    }
}

// How a resolved vault file becomes an image URL: Obsidian's resource URL in
// the plugin UI, an absolute file path for external clients (Raycast).
export type FileUrl = (file: TFile) => string

function resourcePath(app: App, linkpath: string, sourcePath: string, fileUrl: FileUrl): string | null {
    const file = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)
    return file ? fileUrl(file) : null
}

// Thumbnail URL for an image attachment or the first resolvable image a text
// line embeds/links; null when there is none.
export function resolveThumbnail(app: App, node: ParsedNode, fileUrl: FileUrl = f => app.vault.getResourcePath(f)): string | null {
    if (node.nodeType === "attachment") {
        return IMAGE_EXTENSIONS.includes(node.extension.toLowerCase()) ? resourcePath(app, node.name, "", fileUrl) : null
    }
    if (node.nodeType !== "text") return null
    for (const t of node.parsedTokens) {
        let url: string | null = null
        if (t.tokenType === "image") {
            if (/^(https?:|data:)/i.test(t.src)) return t.src
            url = resourcePath(app, safeDecode(t.src), node.location.path, fileUrl)
        } else if (t.tokenType === "obsidian_link") {
            const dot = t.pageTarget.lastIndexOf(".")
            if (dot !== -1 && IMAGE_EXTENSIONS.includes(t.pageTarget.slice(dot + 1).toLowerCase())) {
                url = resourcePath(app, t.pageTarget, node.location.path, fileUrl)
            }
        }
        if (url) return url
    }
    return null
}

// Age in local calendar days of the file a row lives in, from its ctime; null
// when there is no such file. The date for undated rows in Tree and Timeline
// (UI-only; the index itself deliberately ignores fs times).
export function fileAgeDays(app: App | null | undefined, node: ParsedNode): number | null {
    const file = app?.vault.getFileByPath(node.location.path)
    if (!file) return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const created = new Date(file.stat.ctime)
    created.setHours(0, 0, 0, 0)
    // round: DST days are 23/25h long
    return Math.max(0, Math.round((today.getTime() - created.getTime()) / 86_400_000))
}

// Timeline rows for a search result tree (Search view and the Raycast server).
// Undated items take their file's age (fileAgeDays). Results start at the
// matched node, so a hit with no matched ancestor gets its in-note parent
// (e.g. the enclosing header) as breadcrumb. An item whose last matched
// ancestor is one of its inline parents (a note the line links) shows its
// outline parent instead.
export function buildTimelineRows(app: App | null | undefined, graph: NotesGraph, results: ResultNode[], matchExprs: QueryExpr[], windowDays: number | null): TreeNode[] {
    return buildTimeline(results, matchExprs, windowDays, n => fileAgeDays(app, n)).map((item, i) => {
        const last = item.breadcrumb[item.breadcrumb.length - 1]
        const parent = last === undefined ? fileParent(graph, item.node) : outlineContext(graph, item.node, last)
        return {
            node: item.node,
            indent: 0,
            hasChildren: false,
            visible: true,
            selected: false,
            index: i,
            matched: true,
            archived: item.archived,
            timeline: { breadcrumb: parent ? [parent] : item.breadcrumb, pinned: item.pinned, ageDays: item.ageDays, block: item.block }
        }
    })
}

/** Sets `outlineParent` on Tree rows: for a top-level row its in-note parent (fileParent; not a heading's own note,
 *  which its label already names), for a row shown under one of its inline parents its outline parent
 *  (outlineContext). `rows`: pre-order, indent = depth. */
export function tagOutlineParents(graph: NotesGraph, rows: TreeNode[]): void {
    const path: ParsedNode[] = []
    for (const row of rows) {
        if (row.archiveRow) continue
        path.length = row.indent
        const parent = path[row.indent - 1]
        const outline = parent ? outlineContext(graph, row.node, parent) : rootContext(graph, row.node)
        if (outline) row.outlineParent = outline
        path.push(row.node)
    }
}

function rootContext(graph: NotesGraph, node: ParsedNode): ParsedNode | null {
    const parent = fileParent(graph, node)
    return parent && !(node.nodeType === "header" && parent.nodeType === "page") ? parent : null
}

// Breadcrumb segments shown under a timeline row: its matched ancestors, else
// the source note's name.
export function timelineCrumbs(row: TreeNode): string[] {
    const breadcrumb = row.timeline?.breadcrumb ?? []
    return breadcrumb.length > 0
        ? breadcrumb.map(nodeLabel).filter(Boolean)
        : [sourceNoteLabel(row.node)].filter((c): c is string => !!c)
}
