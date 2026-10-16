import type { ArchiveMark, DvList, HeadingCache } from "../graph/types.ts"
import { hasArchiveTag } from "./archive-tag.ts"
import type { Frontmatter } from "./frontmatter.ts"

export const LIST_ITEM_RE = /^(\s*)(?:[-*+]|\d+\.)\s+(.*)/
export const HEADER_RE = /^(#{1,6})\s+(.*)/
// Any list marker, including an empty bullet ("-" alone); used only for outline-break detection
export const LIST_MARKER_RE = /^\s*(?:[-*+]|\d+\.)(?:\s|$)/
const TASK_RE = /^\[([ xX])\]\s+(.*)/
const INLINE_TAG_RE = /#([\w/]+)/g
const META_ACTION_RE = /\(meta-action-[\w-]+::[^)]*\)/g

/** A `[created:: YYYY-MM-DD]` inline field: dates a bullet and makes it indexed even when it is otherwise prose. */
export const CREATED_FIELD_RE = /\[created::\s*\d{4}-\d{2}-\d{2}\s*\]/

/** Pure prose: no links, embeds, tags or URLs. */
export function isProseText(text: string): boolean {
  return !text.includes("[[") && !text.includes("![[") && !text.includes("#") && !text.includes("http")
}

/** Lines that carry no graph-relevant information and should be skipped */
function shouldSkip(text: string, isTask: boolean): boolean {
  if (isTask) return text === ""
  if (CREATED_FIELD_RE.test(text)) return false
  // skip pure prose; tasks are always kept
  return isProseText(text)
}

/** For a trimmed line, undefined if it is not a comment line; otherwise the closer still pending after it ("-->" | "%%"), or null when it closes on the same line. */
export function commentLineClose(trimmed: string): "-->" | "%%" | null | undefined {
  if (trimmed.startsWith("<!--")) return trimmed.indexOf("-->", 4) === -1 ? "-->" : null
  if (trimmed.startsWith("%%")) return trimmed.indexOf("%%", 2) === -1 ? "%%" : null
  return undefined
}

/** Leading-whitespace width, each tab counted as 4. */
export function indentWidth(line: string): number {
  let w = 0
  for (const ch of line) {
    if (ch === "\t") w += 4
    else if (/\s/.test(ch)) w += 1
    else break
  }
  return w
}

/**
 * Scan raw markdown content and produce:
 *  - list: DvList[] (flat, with .parent line refs; .children populated in post-pass)
 *  - headers: HeadingCache[]
 *
 * Mimics the output that Obsidian's Dataview plugin provides via dv.page().
 * List items are only collected from the leading outline; see `outlineEnded`.
 * Headings and lines carrying `#<archiveTag>` are marked `archived: "own"`; the subheadings and lines of an archived
 * heading's section, and the lines nested under an archived line, `archived: "inherited"`.
 */
export function scanMarkdown(
  content: string,
  filePath: string,
  frontmatterBodyStart: number,
  archiveTag: string,
): { lists: DvList[]; headers: HeadingCache[] } {
  const lines = content.split(/\r?\n/)

  // find which line the body starts on (skip frontmatter lines)
  let bodyStartLine = 0
  {
    let chars = 0
    for (let i = 0; i < lines.length; i++) {
      if (chars >= frontmatterBodyStart) {
        bodyStartLine = i
        break
      }
      chars += lines[i].length + 1 // +1 for newline
    }
  }

  const lists: DvList[] = []
  const headers: HeadingCache[] = []

  // current header text for section.subpath
  let currentSectionSubpath = ""

  // stack entries: { indent: number, lineNum: number }
  type StackEntry = { indent: number; lineNum: number; archived?: ArchiveMark }
  const indentStack: StackEntry[] = []

  // header stack for section tracking and parent-header relationship
  type HeaderEntry = { level: number; lineNum: number; text: string; archived?: ArchiveMark }
  const headerStack: HeaderEntry[] = []

  /** `own` when `text` has the tag, else `inherited` under an archived parent. */
  const markOf = (text: string, parentArchived: ArchiveMark | undefined): ArchiveMark | undefined =>
    hasArchiveTag(text, archiveTag) ? "own" : parentArchived ? "inherited" : undefined

  // The outline is the leading run of list items; the first other content line
  // (outside headings/comments/list continuations) starts free-form notes, whose
  // bullets are not indexed. Headings are indexed on both sides of the break.
  let outlineEnded = false
  // true after a list-item line, false after a heading; indented non-list lines
  // while true are continuations of the list item, not a break
  let inList = false
  // open multi-line comment block, with its closing delimiter
  let commentClose: "-->" | "%%" | null = null

  for (let lineNum = bodyStartLine; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum]
    // lines inside a multi-line comment are neither headings, bullets, nor a break
    if (commentClose) {
      if (line.includes(commentClose)) commentClose = null
      continue
    }
    if (!line.trim()) continue

    // ── Comment line (<!-- … -->, %% … %%) ──────────────────────────────────
    const trimmed = line.trim()
    const close = commentLineClose(trimmed)
    if (close !== undefined) {
      commentClose = close
      continue
    }

    // ── Header line ──────────────────────────────────────────────────────────
    const headerMatch = line.match(HEADER_RE)
    if (headerMatch) {
      const level = headerMatch[1].length
      const heading = headerMatch[2].trim()

      const pos = {
        start: { line: lineNum, ch: 0 },
        end: { line: lineNum, ch: line.length },
      }

      // maintain header stack for section subpath
      while (headerStack.length > 0 && headerStack[headerStack.length - 1].level >= level) {
        headerStack.pop()
      }
      const nextLine = lines[lineNum + 1] ?? ""
      const archived = hasArchiveTag(nextLine, archiveTag) && !HEADER_RE.test(nextLine)
        ? "own" : headerStack[headerStack.length - 1]?.archived ? "inherited" : undefined
      headers.push({ heading, level, position: pos, ...(archived ? { archived } : {}) })
      headerStack.push({ level, lineNum, text: heading, archived })
      currentSectionSubpath = `#${heading}`

      // reset list indent stack on new section
      indentStack.length = 0
      inList = false
      continue
    }

    // ── Outline break ────────────────────────────────────────────────────────
    if (!LIST_MARKER_RE.test(line)) {
      if (!(inList && /^\s/.test(line))) outlineEnded = true
      continue
    }
    inList = true
    if (outlineEnded) continue

    // ── List item line ───────────────────────────────────────────────────────
    const listMatch = line.match(LIST_ITEM_RE)
    if (!listMatch) continue

    // Nesting by visual width (a tab = 4 columns), as Obsidian renders it; `col` stays the character offset.
    const indent = indentWidth(listMatch[1])
    let text = listMatch[2].trim()

    // task detection
    const taskMatch = text.match(TASK_RE)
    const isTask = taskMatch !== null
    const isCompleted = taskMatch ? taskMatch[1].toLowerCase() === "x" : false
    if (taskMatch) text = taskMatch[2].trim()

    // strip meta-action properties from text (they go into rawText for token parsing)
    const rawText = text
    text = text.replace(META_ACTION_RE, "").trim()

    // inline tags
    const tags: string[] = []
    let m: RegExpExecArray | null
    INLINE_TAG_RE.lastIndex = 0
    while ((m = INLINE_TAG_RE.exec(text)) !== null) {
      tags.push(`#${m[1]}`)
    }

    if ((rawText === text || text === "") && shouldSkip(text, isTask)) continue

    // parent: pop stack entries with >= current indent
    while (indentStack.length > 0 && indentStack[indentStack.length - 1].indent >= indent) {
      indentStack.pop()
    }
    const parent = indentStack[indentStack.length - 1]
    const parentLineNum = parent?.lineNum
    const archived = markOf(text, parent ? parent.archived : headerStack[headerStack.length - 1]?.archived)

    indentStack.push({ indent, lineNum, archived })

    lists.push({
      link: { path: filePath },
      text,
      rawText,
      line: lineNum,
      position: {
        start: { line: lineNum, col: listMatch[1].length },
        end: { line: lineNum, col: line.length },
      },
      parent: parentLineNum,
      children: [],
      tags,
      section: { subpath: currentSectionSubpath },
      task: isTask,
      completed: isCompleted,
      ...(archived ? { archived } : {}),
    })
  }

  // post-pass: wire .children from .parent line refs (mirrors Dataview embedChildren)
  const byLine = new Map<number, DvList>()
  for (const item of lists) byLine.set(item.line, item)
  for (const item of lists) {
    if (item.parent !== undefined) {
      byLine.get(item.parent)?.children.push(item)
    }
  }

  return { lists, headers }
}

export type { Frontmatter }
