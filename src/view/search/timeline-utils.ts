import type { App, TFile } from "obsidian"
import { buildTimeline, fileParent, isUndated, type NotesGraph, type ParsedNode, type QueryExpr, type ResultNode } from "@mdtree/core"
import type { TreeNode } from "./SearchViewFlatten"

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]

// The first `YYYY-MM-DD` in a text line's own text. It takes precedence in the
// indexer's age computation, so it is exactly the date the row shows.
export function textSourceDate(node: ParsedNode): string | null {
    if (node.nodeType !== "text") return null
    return /\d{4}-\d{2}-\d{2}/.exec(node.searchKey)?.[0] ?? null
}

// Relative date label for a timeline row. `sourceDate` (the line's own date)
// is used verbatim as the absolute date; otherwise it is rebuilt from
// whole-day `ageDays`, which may be off by one near midnight across timezones.
export function formatTimelineDate(ageDays: number, sourceDate: string | null): { label: string; absolute: string } | null {
    if (isUndated(ageDays)) return null
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    let absolute = sourceDate
    if (absolute === null) {
        const d = new Date(today)
        d.setDate(d.getDate() - ageDays)
        absolute = ymd(d)
    }
    // The index clamps future dates to age 0; show them verbatim, not "Today".
    const label = absolute > ymd(today) ? absolute
        : ageDays === 0 ? "Today"
        : ageDays === 1 ? "Yesterday"
        : ageDays < 7 ? `${ageDays}d ago`
        : absolute
    return { label, absolute }
}

// Drop the annotations that repeat the row's date from a text line's plain
// text tokens: bare `date` occurrences and inline fields holding only that date
// (`[scheduled:: date]`, `(due:: date)`). Other dates carry information and stay.
export function stripDateAnnotations(node: ParsedNode, date: string): ParsedNode {
    if (node.nodeType !== "text") return node
    const re = new RegExp(String.raw`\s*(?:[\[(][^\[\]()]*::\s*${date}\s*[\])]|${date})`, "g")
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

// Timeline rows for a search result tree (Search view and the Raycast server).
// Undated items take the ctime of the file their line lives in (timeline-only;
// the index itself deliberately ignores fs times). Age counts local calendar
// days so the row's rebuilt date is exact. Results start at the matched node,
// so a hit with no matched ancestor gets its in-note parent (e.g. the
// enclosing header) as breadcrumb.
export function buildTimelineRows(app: App | null | undefined, graph: NotesGraph, results: ResultNode[], matchExprs: QueryExpr[], windowDays: number | null): TreeNode[] {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const fileAgeDays = (n: ParsedNode) => {
        const file = app?.vault.getFileByPath(n.location.path)
        if (!file) return null
        const created = new Date(file.stat.ctime)
        created.setHours(0, 0, 0, 0)
        // round: DST days are 23/25h long
        return Math.max(0, Math.round((today.getTime() - created.getTime()) / 86_400_000))
    }
    return buildTimeline(results, matchExprs, windowDays, fileAgeDays).map((item, i) => {
        const parent = item.breadcrumb.length === 0 ? fileParent(graph, item.node) : null
        return {
            node: item.node,
            indent: 0,
            hasChildren: false,
            visible: true,
            selected: false,
            index: i,
            matched: true,
            archived: item.archived,
            timeline: { breadcrumb: parent ? [parent] : item.breadcrumb, pinned: item.pinned, ageDays: item.ageDays }
        }
    })
}

// Breadcrumb segments shown under a timeline row: its matched ancestors, else
// the source note's name.
export function timelineCrumbs(row: TreeNode): string[] {
    const breadcrumb = row.timeline?.breadcrumb ?? []
    return breadcrumb.length > 0
        ? breadcrumb.map(nodeLabel).filter(Boolean)
        : [sourceNoteLabel(row.node)].filter((c): c is string => !!c)
}
