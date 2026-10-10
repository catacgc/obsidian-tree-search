// Pure text operations for the inline editor's text fields (MarkdownField). No DOM, no obsidian.
// Every edit returns the new text plus the caret (and optional selection end).

export type TextEdit = { text: string; caret: number; selectionEnd?: number }
/** What a paste carries: files (attachments), plain text and HTML. */
export type PasteData = { files: File[]; plain: string; html: string }

const LIST_MARKER_LINE_RE = /^\s*(?:[-*+]|\d+\.)(?:\s|$)/
const BARE_MARKER_LINE_RE = /^[ \t]*(?:[-*+]|\d+\.)$/
const MARKER_PREFIX_RE = /^([ \t]*(?:[-*+]|\d+\.)[ \t]+)(\[[ xX]\][ \t]+)?/
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

/** Enter in the outline: a new bullet at the caret line's indent; on the first line one level (4 spaces) deeper, so
 *  the top line becomes the parent of what follows. */
export function outlineEnter(text: string, caret: number): TextEdit {
    const start = lineStartAt(text, caret)
    const indent = leadingWhitespace(text.slice(start, lineEndAt(text, caret)))
    return insertAtCaret(text, caret, "\n" + indent + (start === 0 ? "    " : "") + "- ")
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

/** Backspace (empty selection) in the Append outline, which must stay a list:
 *  - a non-first line holding only an indent and/or a bare marker (`-`, `*`, `+`, optionally `[ ]`/`[x]`) is removed
 *    with its preceding newline, caret to the end of the previous line;
 *  - caret inside or right after a line's prefix (indent, marker, checkbox): a checkbox is dropped (caret after the
 *    marker); else a non-first line joins the end of the previous line (caret at the join); the first line keeps its
 *    marker (caret to its text start).
 *  Null otherwise: the field's own Backspace. */
export function outlineBackspace(text: string, caret: number): TextEdit | null {
    const start = lineStartAt(text, caret)
    const end = lineEndAt(text, caret)
    const line = text.slice(start, end)
    if (start > 0 && BARE_BULLET_LINE_RE.test(line)) return {text: text.slice(0, start - 1) + text.slice(end), caret: start - 1}
    const m = MARKER_PREFIX_RE.exec(line)
    if (!m || caret > start + m[0].length) return null
    if (m[2]) {
        const at = start + m[1].length
        return {text: text.slice(0, at) + text.slice(at + m[2].length), caret: at}
    }
    if (start === 0) return {text, caret: m[0].length}
    return {text: text.slice(0, start - 1) + text.slice(start + m[0].length), caret: start - 1}
}

/** How to make `line` a list item: a space after a bare marker (`-`, `*`, `+`, `1.`), else `- ` after the indent of a
 *  line without a marker (blank lines included); null for a list line. `at` is an offset in `line`. */
function bulletFix(line: string): { at: number; insert: string } | null {
    if (BARE_MARKER_LINE_RE.test(line)) return {at: line.length, insert: " "}
    if (LIST_MARKER_LINE_RE.test(line)) return null
    return {at: /^[ \t]*/.exec(line)![0].length, insert: "- "}
}

/** Makes the caret line a list item (bulletFix). Caret shifts with the insertion. Unchanged otherwise. */
export function ensureBullet(text: string, caret: number): TextEdit {
    const ls = lineStartAt(text, caret)
    const fix = bulletFix(text.slice(ls, lineEndAt(text, caret)))
    if (!fix) return {text, caret}
    const at = ls + fix.at
    return {text: text.slice(0, at) + fix.insert + text.slice(at), caret: caret >= at ? caret + fix.insert.length : caret}
}

/** Insertions that make every line of an Append outline a list item (bulletFix per line), as offsets in `text`.
 *  Empty when every line already is one. */
export function outlineRepairs(text: string): { from: number; insert: string }[] {
    const out: { from: number; insert: string }[] = []
    let ls = 0
    for (const line of text.split("\n")) {
        const fix = bulletFix(line)
        if (fix) out.push({from: ls + fix.at, insert: fix.insert})
        ls += line.length + 1
    }
    return out
}

/** Mobile toolbar Task: the caret line (ensureBullet first) becomes a `[ ] ` task after its marker, or loses its
 *  checkbox when it has one. The caret keeps its place in the text (moved after the checkbox when inside the prefix). */
export function toggleTask(text: string, caret: number): TextEdit {
    const e = ensureBullet(text, caret)
    const ls = lineStartAt(e.text, e.caret)
    const m = MARKER_PREFIX_RE.exec(e.text.slice(ls, lineEndAt(e.text, e.caret)))
    if (!m) return e
    const at = ls + m[1].length
    if (m[2]) {
        const end = at + m[2].length
        return {text: e.text.slice(0, at) + e.text.slice(end), caret: e.caret >= end ? e.caret - m[2].length : Math.min(e.caret, at)}
    }
    return {text: e.text.slice(0, at) + "[ ] " + e.text.slice(at), caret: Math.max(e.caret, at) + 4}
}

/** Pasted text as outline lines: blanks dropped, plain lines bulleted, indents mapped to 4-space levels relative to the first line. */
function outlineBlock(pasted: string): string[] {
    const lines = pasted.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n").filter(l => l.trim() !== "")
    const stack: number[] = []
    return lines.map(line => {
        const w = indentWidth(line)
        while (stack.length > 0 && stack[stack.length - 1] >= w) stack.pop()
        const depth = stack.length
        stack.push(w)
        const content = line.trimStart()
        return "    ".repeat(depth) + (LIST_MARKER_LINE_RE.test(content) ? content : "- " + content)
    })
}

const BARE_PREFIX_RE = /^[ \t]*[-*+] (?:\[[ xX]\] )?$/

/** Outline paste (EDITOR.md §3.2). Replaces [start, end) with the pasted lines re-indented under the caret line. Null when nothing pastable. */
export function pasteOutline(text: string, start: number, end: number, pasted: string): TextEdit | null {
    const block = outlineBlock(pasted)
    if (block.length === 0) return null
    const base = text.slice(0, start) + text.slice(end)
    const lineStart = lineStartAt(base, start)
    const lineEnd = lineEndAt(base, start)
    const line = base.slice(lineStart, lineEnd)
    const indent = leadingWhitespace(line)
    const strip = (l: string) => l.trimStart().replace(/^(?:[-*+]|\d+[.)])\s+/, "")

    // At a bare bullet (or a single line): the first line fills the caret position, the rest follow at the caret line's indent.
    if (BARE_PREFIX_RE.test(base.slice(lineStart, start)) || block.length === 1) {
        return insertAtCaret(base, start, [strip(block[0]), ...block.slice(1).map(l => indent + l)].join("\n"))
    }
    // A blank caret line is replaced by the block.
    if (line.trim() === "") {
        const inserted = block.map(l => indent + l).join("\n")
        return {text: base.slice(0, lineStart) + inserted + base.slice(lineEnd), caret: lineStart + inserted.length}
    }
    // Otherwise the block becomes siblings after the caret line.
    const inserted = block.map(l => "\n" + indent + l).join("")
    return {text: base.slice(0, lineEnd) + inserted + base.slice(lineEnd), caret: lineEnd + inserted.length}
}

/** Smallest single replacement turning `from` into `to` (common prefix/suffix kept; they never overlap). */
export function changedRange(from: string, to: string): { from: number; to: number; insert: string } {
    const min = Math.min(from.length, to.length)
    let p = 0
    while (p < min && from[p] === to[p]) p++
    let s = 0
    while (s < min - p && from[from.length - 1 - s] === to[to.length - 1 - s]) s++
    return {from: p, to: from.length - s, insert: to.slice(p, to.length - s)}
}

/** Page of the link nearest column `col` of `line`: the last non-embed link starting before it (so a caret between
 *  `[[A]]` and `[[B]]` gives A), else the line's first link. */
function pageLinkNear(line: string, col: number): string | null {
    let first: string | null = null
    let before: string | null = null
    for (const m of line.matchAll(LINK_RE)) {
        if (m[1] === "!") continue
        const page = m[2].split(/[#|]/)[0].trim()
        if (!page) continue
        first ??= page
        if (m.index! < col) before = page
    }
    return before ?? first
}

/** Note nearest the caret: the caret line's link nearest the caret (pageLinkNear), else the nearest ancestor line's
 *  (smaller indent) link nearest its end, else null. */
export function caretNote(text: string, caret: number): string | null {
    const lines = text.split("\n")
    let idx = text.slice(0, caret).split("\n").length - 1
    const own = pageLinkNear(lines[idx], caret - lineStartAt(text, caret))
    if (own) return own
    let threshold = indentWidth(lines[idx])
    for (idx--; idx >= 0 && threshold > 0; idx--) {
        if (lines[idx].trim() === "") continue
        const w = indentWidth(lines[idx])
        if (w >= threshold) continue
        threshold = w
        const link = pageLinkNear(lines[idx], lines[idx].length)
        if (link) return link
    }
    return null
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

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i

/** The clipboard's plain text as a single URL (trimmed), or null. */
export function pastedUrl(plain: string): string | null {
    const t = plain.trim()
    return URL_RE.test(t) ? t : null
}

/** Paste of `url` over [start, end) as a markdown link (EDITOR.md §3.8): a selection becomes the link
 *  text; otherwise `[title](url)` with the title selected (`[](url)`, caret inside, when untitled).
 *  Null = not a link paste (destination slot, multi-line or URL selection); the caller pastes normally. */
export function pasteLink(text: string, start: number, end: number, url: string, title: string): TextEdit | null {
    if (text.slice(0, start).endsWith("](")) return null
    if (start < end) {
        const sel = text.slice(start, end)
        if (sel.includes("\n") || pastedUrl(sel) !== null) return null
        const link = `[${sel}](${url})`
        return {text: text.slice(0, start) + link + text.slice(end), caret: start + link.length}
    }
    const name = title.replace(/[[\]]/g, "\\$&")
    return {
        text: text.slice(0, start) + `[${name}](${url})` + text.slice(start),
        caret: start + 1,
        selectionEnd: start + 1 + name.length,
    }
}
