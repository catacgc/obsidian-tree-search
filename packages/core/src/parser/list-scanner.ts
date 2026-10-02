import type { DvList, HeadingCache } from "../graph/types.ts"
import type { Frontmatter } from "./frontmatter.ts"

const LIST_ITEM_RE = /^(\s*)(?:[-*+]|\d+\.)\s+(.*)/
const HEADER_RE = /^(#{1,6})\s+(.*)/
// Any list marker, including an empty bullet ("-" alone); used only for outline-break detection
const LIST_MARKER_RE = /^\s*(?:[-*+]|\d+\.)(?:\s|$)/
const TASK_RE = /^\[([ xX])\]\s+(.*)/
const INLINE_TAG_RE = /#([\w/]+)/g
const META_ACTION_RE = /\(meta-action-[\w-]+::[^)]*\)/g
const META_MDTREE_RE = /\(meta-mdtree::\s*\w+\)/g

/** Lines that carry no graph-relevant information and should be skipped */
function shouldSkip(text: string, archiveTag: string): boolean {
  if (text.includes(archiveTag)) return true
  // skip pure prose: no links, tags, tasks, or URLs
  return (
    !text.includes("[[") &&
    !text.includes("![[") &&
    !text.includes("#") &&
    !text.includes("http") &&
    !text.includes("- [")
  )
}

/**
 * Scan raw markdown content and produce:
 *  - list: DvList[] (flat, with .parent line refs; .children populated in post-pass)
 *  - headers: HeadingCache[]
 *
 * Mimics the output that Obsidian's Dataview plugin provides via dv.page().
 * List items are only collected from the leading outline; see `outlineEnded`.
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
  type StackEntry = { indent: number; lineNum: number }
  const indentStack: StackEntry[] = []

  // header stack for section tracking and parent-header relationship
  type HeaderEntry = { level: number; lineNum: number; text: string }
  const headerStack: HeaderEntry[] = []

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
    if (trimmed.startsWith("<!--")) {
      if (trimmed.indexOf("-->", 4) === -1) commentClose = "-->"
      continue
    }
    if (trimmed.startsWith("%%")) {
      if (trimmed.indexOf("%%", 2) === -1) commentClose = "%%"
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
      headers.push({ heading, level, position: pos })

      // maintain header stack for section subpath
      while (headerStack.length > 0 && headerStack[headerStack.length - 1].level >= level) {
        headerStack.pop()
      }
      headerStack.push({ level, lineNum, text: heading })
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

    const indent = listMatch[1].length
    let text = listMatch[2].trim()

    // task detection
    const taskMatch = text.match(TASK_RE)
    const isTask = taskMatch !== null
    const isCompleted = taskMatch ? taskMatch[1].toLowerCase() === "x" : false
    if (taskMatch) text = taskMatch[2].trim()

    // strip meta-action properties from text (they go into rawText for token parsing)
    const rawText = text
    text = text.replace(META_ACTION_RE, "").replace(META_MDTREE_RE, "").trim()

    // inline tags
    const tags: string[] = []
    let m: RegExpExecArray | null
    INLINE_TAG_RE.lastIndex = 0
    while ((m = INLINE_TAG_RE.exec(text)) !== null) {
      tags.push(`#${m[1]}`)
    }

    if ((rawText === text || text === "") && shouldSkip(text, "#" + archiveTag)) continue

    // parent: pop stack entries with >= current indent
    while (indentStack.length > 0 && indentStack[indentStack.length - 1].indent >= indent) {
      indentStack.pop()
    }
    const parentLineNum = indentStack.length > 0 ? indentStack[indentStack.length - 1].lineNum : undefined

    indentStack.push({ indent, lineNum })

    lists.push({
      link: { path: filePath },
      text,
      rawText,
      line: lineNum,
      position: {
        start: { line: lineNum, col: indent },
        end: { line: lineNum, col: line.length },
      },
      parent: parentLineNum,
      children: [],
      tags,
      section: { subpath: currentSectionSubpath },
      task: isTask,
      completed: isCompleted,
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
