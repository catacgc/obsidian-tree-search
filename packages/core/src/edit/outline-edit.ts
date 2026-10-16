import type { ParsedNode } from "../graph/types.ts"
import { HEADER_RE, LIST_ITEM_RE, LIST_MARKER_RE, commentLineClose, indentWidth } from "../parser/list-scanner.ts"
import { frontmatterEnd, splitLines } from "../search/organise-sections.ts"

// Pure, content-in/content-out edits for editor mode. Every function keeps
// the note's line ending and never touches frontmatter; new lines are written
// at 4 spaces per level (the `renderPullLine` convention), or one tab per level
// in files whose list lines are tab-indented.

export type OutlineLine = { depth: number; marker: string; text: string } // marker: "- " | "- [ ] " | "- [x] "
export type OutlineIssue = { kind: "empty" } | { kind: "heading"; line: number } | { kind: "plain"; line: number }

export class StaleLineError extends Error {
  constructor() {
    super("Line changed since editing started — reopen the editor")
    this.name = "StaleLineError"
  }
}

const INDENT = "    "
const BULLET_RE = /^\s*(?:[-*+]|\d+\.)(\s+|$)/
const CHECKBOX_RE = /^\[([ xX])\]\s+/
const HEADING_TEXT_RE = /^#{1,6}\s+\S/
const LINK_ONLY_RE = /^\[\[([^\]|]+)(\|[^\]]*)?\]\]$/

/** A file's indent unit: a tab when any of its list lines is tab-indented, else 4 spaces, so new lines match the file. */
function indentUnitOf(lines: string[]): string {
  return lines.some(l => /^\t+(?:[-*+]|\d+\.)\s/.test(l)) ? "\t" : INDENT
}

/** `line` re-indented `depth` levels deeper in `unit`, reading its own indent as 4-wide levels. */
function indentBy(line: string, depth: number, unit: string): string {
  const width = indentWidth(line)
  return unit.repeat(depth + Math.floor(width / 4)) + " ".repeat(width % 4) + line.trimStart()
}

// ── Outline text (the editor's textarea) ────────────────────────────────────

export function parseOutline(input: string): { lines: OutlineLine[]; issues: OutlineIssue[] } {
  const lines: OutlineLine[] = []
  const issues: OutlineIssue[] = []
  const raw = input.split("\n")
  for (let i = 0; i < raw.length; i++) {
    const src = raw[i].replace(/\r$/, "")
    if (!src.trim()) continue
    const lead = src.match(/^\s*/)![0]
    const line = lead.replace(/\t/g, INDENT) + src.slice(lead.length)
    const spaces = line.length - line.trimStart().length

    let marker = "- "
    let text: string
    const bullet = line.match(BULLET_RE)
    if (bullet) {
      text = line.slice(bullet[0].length)
      const box = text.match(CHECKBOX_RE)
      if (box) {
        marker = box[1] === " " ? "- [ ] " : "- [x] "
        text = text.slice(box[0].length)
      }
    } else {
      text = line.trimStart()
    }
    text = text.trimEnd()
    if (!text) continue

    const prev = lines.length > 0 ? lines[lines.length - 1].depth : -1
    const depth = Math.min(Math.floor(spaces / 4), prev + 1)
    lines.push({ depth, marker, text })

    if (HEADING_TEXT_RE.test(text)) issues.push({ kind: "heading", line: i })
    else if (marker === "- " && !text.includes("[[") && !text.includes("#") && !text.includes("http")) issues.push({ kind: "plain", line: i })
  }
  if (lines.length === 0) issues.push({ kind: "empty" })
  return { lines, issues }
}

export function renderOutline(lines: OutlineLine[], baseDepth: number, unit: string = INDENT): string[] {
  return lines.map(l => unit.repeat(baseDepth + l.depth) + l.marker + l.text)
}

// ── Leading-outline scan (mirrors `scanMarkdown`'s break state machine) ──────

type OutlineScan = {
  /** Last list line (or its indented continuation) before the break, or -1. */
  lastOutline: number
  /** First outline-breaking line, or -1. */
  breakLine: number
  /** List-item lines inside the leading outline, in order. */
  listLines: number[]
}

function scanOutline(lines: string[]): OutlineScan {
  let lastOutline = -1
  let breakLine = -1
  const listLines: number[] = []
  let inList = false
  let commentClose: "-->" | "%%" | null = null

  for (let i = frontmatterEnd(lines); i < lines.length; i++) {
    const line = lines[i]
    if (commentClose) {
      if (line.includes(commentClose)) commentClose = null
      continue
    }
    if (!line.trim()) continue
    const close = commentLineClose(line.trim())
    if (close !== undefined) {
      commentClose = close
      continue
    }
    if (HEADER_RE.test(line)) {
      inList = false
      continue
    }
    if (!LIST_MARKER_RE.test(line)) {
      if (inList && /^\s/.test(line)) {
        lastOutline = i
        continue
      }
      breakLine = i
      break
    }
    inList = true
    lastOutline = i
    if (LIST_ITEM_RE.test(line)) listLines.push(i)
  }
  return { lastOutline, breakLine, listLines }
}

function outlineEndOf(lines: string[]): number {
  const { lastOutline, breakLine } = scanOutline(lines)
  if (lastOutline >= 0) return lastOutline + 1
  if (breakLine >= 0) return breakLine
  return lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length
}

/** Link target (`page` or `page#header`) when `text` is exactly one wikilink `[[X]]` / `[[X|alias]]` (trimmed), else null. */
export function linkOnlyTarget(text: string): string | null {
  const link = text.trim().match(LINK_ONLY_RE)
  return link ? link[1].trim() : null
}

function linkBulletOf(lines: string[], pageName: string): number | null {
  const want = pageName.trim().toLowerCase()
  for (const i of scanOutline(lines).listLines) {
    const item = lines[i].match(LIST_ITEM_RE)
    const target = item ? linkOnlyTarget(item[2]) : null
    if (target !== null && target.toLowerCase() === want) return i
  }
  return null
}

/** Line index where new outline bullets go: after the leading outline, else before the first breaking line, else at end of file (before its trailing newline). */
export function findOutlineEnd(content: string): number {
  return outlineEndOf(splitLines(content).lines)
}

/** Message of the error replaceNoteBody (and writeNoteBody) throws when the note's body isn't the one loaded. */
export const NOTE_BODY_CHANGED = "The note's content changed since it was loaded — copy your edits, then reopen the note"

/** First line of a note's body: the line after its leading outline's last line, else (no outline) after the frontmatter. */
function bodyStartOf(lines: string[]): number {
  const { lastOutline } = scanOutline(lines)
  return lastOutline >= 0 ? lastOutline + 1 : frontmatterEnd(lines)
}

function trimBlankLines(lines: string[]): string[] {
  let a = 0
  let b = lines.length
  while (a < b && !lines[a].trim()) a++
  while (b > a && !lines[b - 1].trim()) b--
  return lines.slice(a, b)
}

/** What follows a note's leading outline (with no outline: everything after the frontmatter), without leading and
 *  trailing blank lines, joined by "\n": the text the outline editor's content pane edits. "" when there is none. */
export function noteBody(content: string): string {
  const { lines } = splitLines(content)
  return trimBlankLines(lines.slice(bodyStartOf(lines))).join("\n")
}

/** `content` with its body (noteBody) replaced by `body`. The head (frontmatter + leading outline) is kept, without
 *  trailing blank lines; one blank line separates it from a non-empty body; the result ends with one line ending
 *  (the file's). Throws Error(NOTE_BODY_CHANGED) when noteBody(content) !== expected. */
export function replaceNoteBody(content: string, expected: string, body: string): string {
  const { lines, eol } = splitLines(content)
  const start = bodyStartOf(lines)
  if (trimBlankLines(lines.slice(start)).join("\n") !== expected) throw new Error(NOTE_BODY_CHANGED)
  const head = lines.slice(0, start)
  while (head.length > 0 && !head[head.length - 1].trim()) head.pop()
  const next = trimBlankLines(body.split(/\r\n|\r|\n/))
  const out = head.length === 0 ? next : next.length === 0 ? head : [...head, "", ...next]
  return out.length === 0 ? "" : out.join(eol) + eol
}

/** The heading `heading` (its text, as the index names it) in `lines`: its line and level, and the exclusive end of
 *  its section (the next heading of the same or a higher level, outside code fences); null when there is none. An
 *  exact text match wins over a case-insensitive one. */
function headingSectionOf(lines: string[], heading: string): { line: number; end: number } | null {
  const want = heading.trim()
  const found: { line: number; level: number; text: string }[] = []
  let fence: string | null = null
  for (let i = frontmatterEnd(lines); i < lines.length; i++) {
    const t = lines[i].trimStart()
    const f = /^(`{3,}|~{3,})/.exec(t)?.[1]
    if (f && (fence === null || f[0] === fence[0])) {
      fence = fence === null ? f : null
      continue
    }
    if (fence !== null) continue
    const m = HEADER_RE.exec(lines[i])
    if (m) found.push({ line: i, level: m[1].length, text: m[2].replace(/\s+#+\s*$/, "").trim() })
  }
  const pick = found.findIndex(h => h.text === want) >= 0
    ? found.findIndex(h => h.text === want)
    : found.findIndex(h => h.text.toLowerCase() === want.toLowerCase())
  if (pick < 0) return null
  const h = found[pick]
  const next = found.slice(pick + 1).find(n => n.level <= h.level)
  return { line: h.line, end: next ? next.line : lines.length }
}

/** `content`'s lines without the empty last element a trailing line ending leaves, and whether there was one. */
function splitBody(content: string): { lines: string[]; eol: string; trailing: boolean } {
  const { lines, eol } = splitLines(content)
  const trailing = lines.length > 1 && lines[lines.length - 1] === ""
  if (trailing) lines.pop()
  return { lines, eol, trailing }
}

/** The text under heading `heading` (up to the next heading of the same or a higher level), without leading and
 *  trailing blank lines, joined by "\n": what the outline editor's content pane edits for a heading root. Null when the note
 *  has no such heading. */
export function headingBody(content: string, heading: string): string | null {
  const { lines } = splitBody(content)
  const s = headingSectionOf(lines, heading)
  return s ? trimBlankLines(lines.slice(s.line + 1, s.end)).join("\n") : null
}

/** `content` with the text under heading `heading` (headingBody) replaced by `body`; the heading line and the blank
 *  lines around the text are kept. Throws Error(NOTE_BODY_CHANGED) when the heading is gone or its text isn't
 *  `expected`. */
export function replaceHeadingBody(content: string, heading: string, expected: string, body: string): string {
  const { lines, eol, trailing } = splitBody(content)
  const s = headingSectionOf(lines, heading)
  if (!s) throw new Error(NOTE_BODY_CHANGED)
  const raw = lines.slice(s.line + 1, s.end)
  let a = 0
  while (a < raw.length && !raw[a].trim()) a++
  let b = raw.length
  while (b > a && !raw[b - 1].trim()) b--
  if (raw.slice(a, b).join("\n") !== expected) throw new Error(NOTE_BODY_CHANGED)
  const next = trimBlankLines(body.split(/\r\n|\r|\n/))
  const section = next.length === 0 ? raw.slice(b) : [...raw.slice(0, a), ...next, ...raw.slice(b)]
  const out = [...lines.slice(0, s.line + 1), ...section, ...lines.slice(s.end)]
  return out.join(eol) + (trailing ? eol : "")
}

/** Exclusive end of the subtree headed by `headLine`: inner blank lines count, trailing blank lines don't. */
export function findSubtreeEnd(lines: string[], headLine: number): number {
  const head = indentWidth(lines[headLine])
  let end = headLine + 1
  for (let i = headLine + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    if (indentWidth(lines[i]) <= head) break
    end = i + 1
  }
  return end
}

/** First leading-outline bullet that is exactly `[[pageName]]` / `[[pageName|alias]]` (case-insensitive; `pageName` may be `page#header`). */
export function findLinkBullet(content: string, pageName: string): number | null {
  return linkBulletOf(splitLines(content).lines, pageName)
}

export function appendUnderLinkBullet(content: string, pageName: string, outline: OutlineLine[]): string {
  const { lines, eol } = splitLines(content)
  const unit = indentUnitOf(lines)
  const bullet = linkBulletOf(lines, pageName)
  if (bullet !== null) {
    const base = Math.floor(indentWidth(lines[bullet]) / 4) + 1
    lines.splice(findSubtreeEnd(lines, bullet), 0, ...renderOutline(outline, base, unit))
  } else {
    lines.splice(outlineEndOf(lines), 0, `- [[${pageName}]]`, ...renderOutline(outline, 1, unit))
  }
  return lines.join(eol)
}

/** Writes an editor outline into a note. Each root bullet that is exactly `[[X]]` merges its children under
 *  the note's first leading-outline `[[X]]` bullet; any other root (or a link root with no such bullet)
 *  is inserted with its subtree at the outline end, as typed. */
export function appendOutline(content: string, outline: OutlineLine[]): string {
  const groups: OutlineLine[][] = []
  for (const line of outline) {
    if (line.depth === 0 || groups.length === 0) groups.push([line])
    else groups[groups.length - 1].push(line)
  }
  let out = content
  for (const [root, ...children] of groups) {
    const target = linkOnlyTarget(root.text)
    if (target !== null && findLinkBullet(out, target) !== null) {
      out = appendUnderLinkBullet(out, target, children.map(l => ({ ...l, depth: l.depth - 1 })))
    } else {
      const { lines, eol } = splitLines(out)
      lines.splice(outlineEndOf(lines), 0, ...renderOutline([root, ...children], 0, indentUnitOf(lines)))
      out = lines.join(eol)
    }
  }
  return out
}

/** Line of the item `appendOutline` added when turning `before` into `after`: the first inserted line, or the line after it when that is a new bare `[[X]]` root heading deeper inserted lines. Null when nothing was inserted. */
export function firstAppendedLine(before: string, after: string): number | null {
  const beforeLines = splitLines(before).lines
  const afterLines = splitLines(after).lines
  let i = 0
  while (i < afterLines.length && i < beforeLines.length && afterLines[i] === beforeLines[i]) i++
  if (i >= afterLines.length) return null
  const inserted = afterLines.length - beforeLines.length
  const item = afterLines[i].match(LIST_ITEM_RE)
  if (item && linkOnlyTarget(item[2]) !== null && inserted > 1 && i + 1 < afterLines.length
    && indentWidth(afterLines[i + 1]) > indentWidth(afterLines[i])) return i + 1
  return i
}

/** Appends `text` as a new paragraph: one blank line before it (unless already there), ending with a newline. */
export function appendContent(content: string, text: string): string {
  const { eol } = splitLines(content)
  const body = text.replace(/(\r?\n)+$/, "").split(/\r?\n/).join(eol)
  if (content === "") return body + eol
  let out = content.endsWith(eol) ? content : content + eol
  if (!out.endsWith(eol + eol)) out += eol
  return out + body + eol
}

// ── Single-line edit ───────────────────────────────────────────────────────

const EDIT_LIST_PREFIX_RE = /^(\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?)(.*)$/
const EDIT_HEADING_PREFIX_RE = /^(#{1,6}\s+)(.*)$/

export function splitEditableLine(line: string): { prefix: string; text: string } | null {
  const m = line.match(EDIT_LIST_PREFIX_RE) ?? line.match(EDIT_HEADING_PREFIX_RE)
  return m ? { prefix: m[1], text: m[2] } : null
}

/** Whether a fresh file line still carries the identity of the indexed node that points at it. */
export function lineHasIdentity(line: string, node: ParsedNode): boolean {
  const l = line.toLowerCase()
  switch (node.nodeType) {
    case "text": {
      const links = node.parsedTokens.flatMap(t => (t.tokenType === "obsidian_link" ? [t.pageTarget] : []))
      return [...links, ...node.tags].every(s => l.includes(s.toLowerCase()))
    }
    case "page":
      return l.includes("[[") && l.includes(node.page.toLowerCase())
    case "header":
      return l.includes(node.header.toLowerCase())
    default:
      return false
  }
}

/** Replaces the whole line `line` with `newText`; throws `StaleLineError` if it no longer equals `expectedLine`. */
export function replaceLineText(content: string, line: number, expectedLine: string, newText: string): string {
  const { lines, eol } = splitLines(content)
  if (lines[line] !== expectedLine) throw new StaleLineError()
  lines[line] = newText
  return lines.join(eol)
}

/** Rewrites list or heading line `line` of `content` to `first` and inserts `extra` (OutlineLine depths relative to
 *  the line: 0 = same depth, 1 = a child, …). Throws StaleLineError when `lines[line] !== expectedLine`.
 *  List line: the extra lines before the first depth-0 one go right after the line (before its existing children);
 *  the rest (from the first depth-0 line, with the deeper lines after it) go after the line's subtree (findSubtreeEnd).
 *  Heading line: every extra line goes right after the heading, depth 0 at column 0.
 *  Rendered as `unit.repeat(base + depth) + marker + text` where base = floor(indentWidth(expectedLine) / 4) for a list
 *  line (0 for a heading) and unit = the file's indent unit (tab-indented files use tabs).
 *  Keeps the line ending and the trailing newline. `inserted`: the inserted blocks as line numbers in the returned
 *  content, in file order. */
export function editOutlineBlock(
  content: string,
  line: number,
  expectedLine: string,
  first: string,
  extra: OutlineLine[],
): { content: string; inserted: { at: number; count: number }[] } {
  const { lines, eol } = splitLines(content)
  if (lines[line] !== expectedLine) throw new StaleLineError()
  const heading = HEADER_RE.test(expectedLine)
  const unit = indentUnitOf(lines)
  const base = heading ? 0 : Math.floor(indentWidth(expectedLine) / 4)
  const end = heading ? line + 1 : findSubtreeEnd(lines, line)
  lines[line] = first
  if (extra.length === 0) return { content: lines.join(eol), inserted: [] }
  if (heading) {
    lines.splice(line + 1, 0, ...renderOutline(extra, base, unit))
    return { content: lines.join(eol), inserted: [{ at: line + 1, count: extra.length }] }
  }
  const split = extra.findIndex(l => l.depth === 0)
  const children = split < 0 ? extra : extra.slice(0, split)
  const siblings = split < 0 ? [] : extra.slice(split)
  lines.splice(end, 0, ...renderOutline(siblings, base, unit))
  lines.splice(line + 1, 0, ...renderOutline(children, base, unit))
  const inserted: { at: number; count: number }[] = []
  if (children.length > 0) inserted.push({ at: line + 1, count: children.length })
  if (siblings.length > 0) inserted.push({ at: end + children.length, count: siblings.length })
  return { content: lines.join(eol), inserted }
}

// ── Reparent (cut / paste a bullet subtree) ────────────────────────────────

/** Removes the subtree headed by `headLine`; `block` is it re-indented so the head sits at 0 (4 spaces per tab, blank lines as ""). */
export function cutSubtree(content: string, headLine: number, expectedHead: string): { content: string; block: string[] } {
  const { lines, eol } = splitLines(content)
  if (lines[headLine] !== expectedHead) throw new StaleLineError()
  const end = findSubtreeEnd(lines, headLine)
  const headWidth = indentWidth(expectedHead)
  const block = lines
    .splice(headLine, end - headLine)
    .map(l => (l.trim() ? " ".repeat(indentWidth(l) - headWidth) + l.trimStart() : ""))
  return { content: lines.join(eol), block }
}

/** Removes heading `headLine` and its section: every line up to the next heading of the same or a higher level
 *  (outside ``` / ~~~ fences), else to the end of the file, keeping the file's final newline. */
export function cutHeadingSection(content: string, headLine: number, expectedHead: string): string {
  const { lines, eol } = splitLines(content)
  const head = lines[headLine] === expectedHead ? HEADER_RE.exec(expectedHead) : null
  if (!head) throw new StaleLineError()
  const level = head[1].length
  let end = -1
  let inFence = false
  for (let i = headLine + 1; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence
    else if (!inFence) {
      const m = HEADER_RE.exec(lines[i])
      if (m && m[1].length <= level) {
        end = i
        break
      }
    }
  }
  if (end < 0) end = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length
  lines.splice(headLine, end - headLine)
  return lines.join(eol)
}

/** Inserts `block` as the last children of the leading-outline `[[pageName]]` bullet (`pageName` may be `page#header`), adding that bullet at the outline end if missing. */
export function pasteUnderLinkBullet(content: string, pageName: string, block: string[]): string {
  const { lines, eol } = splitLines(content)
  const unit = indentUnitOf(lines)
  let bullet = linkBulletOf(lines, pageName)
  if (bullet === null) {
    bullet = outlineEndOf(lines)
    lines.splice(bullet, 0, `- [[${pageName}]]`)
  }
  const depth = Math.floor(indentWidth(lines[bullet]) / 4) + 1
  lines.splice(findSubtreeEnd(lines, bullet), 0, ...block.map(l => (l === "" ? "" : indentBy(l, depth, unit))))
  return lines.join(eol)
}

/** Inserts `block` as the last children of the line `headLine`; throws `StaleLineError` if it no longer equals `expectedHead`. `line` is the first inserted line. */
export function pasteUnderLine(content: string, headLine: number, expectedHead: string, block: string[]): { content: string; line: number } {
  const { lines, eol } = splitLines(content)
  if (lines[headLine] !== expectedHead) throw new StaleLineError()
  const depth = Math.floor(indentWidth(expectedHead) / 4) + 1
  const unit = indentUnitOf(lines)
  const line = findSubtreeEnd(lines, headLine)
  lines.splice(line, 0, ...block.map(l => (l === "" ? "" : indentBy(l, depth, unit))))
  return { content: lines.join(eol), line }
}

/** Whether the frontmatter or leading outline differs between `before` and `after` (prose after the outline is ignored). */
export function outlineChanged(before: string, after: string): boolean {
  const a = splitLines(before).lines
  const b = splitLines(after).lines
  const aEnd = outlineEndOf(a)
  const bEnd = outlineEndOf(b)
  if (aEnd !== bEnd) return true
  for (let i = 0; i < aEnd; i++) if (a[i] !== b[i]) return true
  return false
}

export function pasteAtOutlineEnd(content: string, block: string[]): string {
  const { lines, eol } = splitLines(content)
  const unit = indentUnitOf(lines)
  lines.splice(outlineEndOf(lines), 0, ...block.map(l => (l === "" ? "" : indentBy(l, 0, unit))))
  return lines.join(eol)
}
