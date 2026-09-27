import type { App } from "obsidian"
import { isUndated, type ParsedNode } from "@mdtree/core"

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

function resourcePath(app: App, linkpath: string, sourcePath: string): string | null {
    const file = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)
    return file ? app.vault.getResourcePath(file) : null
}

// Thumbnail URL for an image attachment or the first resolvable image a text
// line embeds/links; null when there is none.
export function resolveThumbnail(app: App, node: ParsedNode): string | null {
    if (node.nodeType === "attachment") {
        return IMAGE_EXTENSIONS.includes(node.extension.toLowerCase()) ? resourcePath(app, node.name, "") : null
    }
    if (node.nodeType !== "text") return null
    for (const t of node.parsedTokens) {
        let url: string | null = null
        if (t.tokenType === "image") {
            if (/^(https?:|data:)/i.test(t.src)) return t.src
            url = resourcePath(app, safeDecode(t.src), node.location.path)
        } else if (t.tokenType === "obsidian_link") {
            const dot = t.pageTarget.lastIndexOf(".")
            if (dot !== -1 && IMAGE_EXTENSIONS.includes(t.pageTarget.slice(dot + 1).toLowerCase())) {
                url = resourcePath(app, t.pageTarget, node.location.path)
            }
        }
        if (url) return url
    }
    return null
}
