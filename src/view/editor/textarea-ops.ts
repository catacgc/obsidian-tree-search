// Pure text operations for the inline editor's textareas. No DOM, no obsidian.
// Every edit returns the new text plus the caret (and optional selection end).

export type TextEdit = { text: string; caret: number; selectionEnd?: number }

const LIST_MARKER_LINE_RE = /^\s*(?:[-*+]|\d+\.)(?:\s|$)/
const LINK_RE = /(!?)\[\[([^\]\n]*)\]\]/g

function lineStartAt(text: string, caret: number): number {
    return text.lastIndexOf("\n", caret - 1) + 1
}

function lineEndAt(text: string, caret: number): number {
    const end = text.indexOf("\n", caret)
    return end === -1 ? text.length : end
}

function leadingWhitespace(line: string): string {
    return /^\s*/.exec(line)![0]
}

function indentWidth(line: string): number {
    let w = 0
    for (const ch of leadingWhitespace(line)) w += ch === "\t" ? 4 : 1
    return w
}

function firstPageLink(line: string): string | null {
    for (const m of line.matchAll(LINK_RE)) {
        if (m[1] === "!") continue
        const page = m[2].split(/[#|]/)[0].trim()
        if (page) return page
    }
    return null
}

/** The `[[query` being typed before the caret, or null outside an open link. */
export function linkQueryAt(text: string, caret: number): { start: number; query: string } | null {
    if (caret < 2) return null
    const start = text.lastIndexOf("[[", caret - 2)
    if (start === -1) return null
    const between = text.slice(start, caret)
    if (between.includes("]]") || between.includes("\n")) return null
    if (start > 0 && text[start - 1] === "!") return null
    return { start, query: text.slice(start + 2, caret) }
}

/** Replaces `[start, caret)` — and a directly following `]]` — with `link`. */
export function acceptLink(text: string, start: number, caret: number, link: string): TextEdit {
    const end = text.startsWith("]]", caret) ? caret + 2 : caret
    return { text: text.slice(0, start) + link + text.slice(end), caret: start + link.length }
}

/** Page part of the non-embed `[[…]]` whose inner range `[open + 2, close]` contains the caret. */
export function linkAt(text: string, caret: number): string | null {
    for (const m of text.matchAll(LINK_RE)) {
        const open = m.index! + m[1].length
        const close = open + 2 + m[2].length
        if (caret < open + 2 || caret > close) continue
        if (m[1] === "!") return null
        return m[2].split(/[#|]/)[0].trim() || null
    }
    return null
}

/** Page part of the first non-embed link on the caret's line. */
export function firstLinkOnLine(text: string, caret: number): string | null {
    return firstPageLink(text.slice(lineStartAt(text, caret), lineEndAt(text, caret)))
}

/** Enter in the outline: a new bullet at the current line's indent. */
export function outlineEnter(text: string, caret: number): TextEdit {
    const line = text.slice(lineStartAt(text, caret), lineEndAt(text, caret))
    return insertAtCaret(text, caret, "\n" + leadingWhitespace(line) + "- ")
}

/** Tab / Shift+Tab: shift the caret line by ±4 spaces, clamped to [0, previous line indent + 4] (0 on the first line). */
export function outlineIndent(text: string, caret: number, dir: 1 | -1): TextEdit {
    const start = lineStartAt(text, caret)
    const end = lineEndAt(text, caret)
    const line = text.slice(start, end)
    const lead = leadingWhitespace(line)
    const max = start === 0 ? 0 : indentWidth(text.slice(lineStartAt(text, start - 1), start - 1)) + 4
    const width = Math.max(0, Math.min(indentWidth(line) + dir * 4, max))
    const next = " ".repeat(width)
    const delta = next.length - lead.length
    return {
        text: text.slice(0, start) + next + line.slice(lead.length) + text.slice(end),
        caret: Math.max(start, caret + delta),
    }
}

/** Initial Append outline for parent `p`: the parent bullet and an empty child, caret goes at the end. */
export function appendPrefill(parentName: string): string {
    return `- [[${parentName}]]\n    - `
}

const BARE_BULLET_LINE_RE = /^[ \t]*(?:[-*+](?: \[[ xX]\])?)?[ \t]*$/

/** Backspace on a non-first line holding only an indent and/or a bare marker (`-`, `*`, `+`, optionally `[ ]`/`[x]`):
 *  removes that line and its preceding newline; caret to the end of the previous line. Null otherwise. */
export function outlineBackspace(text: string, caret: number): TextEdit | null {
    const start = lineStartAt(text, caret)
    if (start === 0) return null
    const end = lineEndAt(text, caret)
    if (!BARE_BULLET_LINE_RE.test(text.slice(start, end))) return null
    return {text: text.slice(0, start - 1) + text.slice(end), caret: start - 1}
}

/** Swap the outline's parent: blank outline → appendPrefill(p); first line `- [[X]]` (no indent, link only) → replaced by `- [[p]]`;
 *  otherwise prepend `- [[p]]`, and if the first original line has no indent, indent every non-blank original line by 4 spaces. */
export function replaceOutlineParent(text: string, parentName: string): string {
    const lines = text.split("\n")
    if (lines.every(l => /^\s*(?:[-*+]\s*)?$/.test(l))) return appendPrefill(parentName)
    const head = `- [[${parentName}]]`
    if (/^- \[\[[^\]\n]+\]\]\s*$/.test(lines[0])) return [head, ...lines.slice(1)].join("\n")
    const body = /^\s/.test(lines[0]) ? lines : lines.map(l => (l.trim() ? "    " + l : l))
    return [head, ...body].join("\n")
}

/** Multi-line paste into the outline: CRLF→LF, tabs→4 spaces, blank lines dropped, plain lines turned into bullets. */
export function normalizePastedOutline(pasted: string): string {
    return pasted
        .replace(/\r\n/g, "\n")
        .replace(/\t/g, "    ")
        .split("\n")
        .filter(l => l.trim() !== "")
        .map(l => LIST_MARKER_LINE_RE.test(l) ? l : leadingWhitespace(l) + "- " + l.trim())
        .join("\n")
}

/** Note that owns the caret line: its own first link, else the nearest ancestor line's link, else `fallback`. */
export function outlineBaseNote(text: string, caret: number, fallback: string): string {
    const lines = text.split("\n")
    let idx = text.slice(0, caret).split("\n").length - 1
    const own = firstPageLink(lines[idx])
    if (own) return own
    let threshold = indentWidth(lines[idx])
    for (idx--; idx >= 0 && threshold > 0; idx--) {
        if (lines[idx].trim() === "") continue
        const w = indentWidth(lines[idx])
        if (w >= threshold) continue
        threshold = w
        const link = firstPageLink(lines[idx])
        if (link) return link
    }
    return fallback
}

/** Pasted attachments in the outline: fill an empty bullet on the caret line, then add child bullets. */
export function insertAttachmentBullets(text: string, caret: number, names: string[]): TextEdit {
    if (names.length === 0) return { text, caret }
    const start = lineStartAt(text, caret)
    const end = lineEndAt(text, caret)
    let line = text.slice(start, end)
    const childIndent = " ".repeat(indentWidth(line) + 4)
    let rest = names
    if (/^\s*- (\[[ xX]\] )?$/.test(line)) {
        line += `![[${names[0]}]]`
        rest = names.slice(1)
    }
    const added = rest.map(n => "\n" + childIndent + `- ![[${n}]]`).join("")
    const head = text.slice(0, start) + line + added
    return { text: head + text.slice(end), caret: head.length }
}

export function insertAtCaret(text: string, caret: number, insert: string): TextEdit {
    return { text: text.slice(0, caret) + insert + text.slice(caret), caret: caret + insert.length }
}

/** Wraps `[start, end)` in `before`/`after`, keeping the original selection selected. */
export function wrapSelection(text: string, start: number, end: number, before: string, after: string): TextEdit {
    return {
        text: text.slice(0, start) + before + text.slice(start, end) + after + text.slice(end),
        caret: start + before.length,
        selectionEnd: end + before.length,
    }
}

/** Mod+K: `[sel](url)` with `url` selected. */
export function wrapLink(text: string, start: number, end: number): TextEdit {
    const sel = text.slice(start, end)
    const caret = start + sel.length + 3
    return {
        text: text.slice(0, start) + `[${sel}](url)` + text.slice(end),
        caret,
        selectionEnd: caret + 3,
    }
}
