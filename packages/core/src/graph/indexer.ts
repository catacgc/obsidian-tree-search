import type { DvList, DvPage, HeaderNode, ParsedNode, TextNode } from "./types.ts"
import type { NotesGraph } from "./graph.ts"
import { getKey } from "./graph.ts"
import { calculateBoost, getAgeDays } from "./boost.ts"
import { parseTokens } from "../parser/inline-tokens.ts"

export type IndexSettings = {
  parentRelation: string // default: "parent"
  archiveTag: string // default: "archive"
  searchSeparator: string // default: "."
}

export const DEFAULT_SETTINGS: IndexSettings = {
  parentRelation: "parent",
  archiveTag: "archive",
  searchSeparator: ".",
}

// ── shouldSkip ────────────────────────────────────────────────────────────────

function shouldSkip(lst: DvList, archiveTag: string): boolean {
  if (lst.tags.includes(archiveTag)) return true

  if (lst.section.subpath) {
    const header = lst.section.subpath.replace(/#/g, " ").trim()
    if (header.startsWith("--") && header.endsWith("--")) return true
  }

  if (lst.tags.length > 0) return false

  // If meta-actions were stripped (rawText !== text), don't skip — we have parsedTokens to render
  if (lst.rawText !== lst.text) return false

  return isOnlyText(lst.text)
}

function isOnlyText(text: string): boolean {
  return (
    !text.includes("[[") &&
    !text.includes("![[") &&
    !text.includes("#") &&
    !text.includes("http")
  )
}

// ── createNodeFromText ────────────────────────────────────────────────────────

function createNodeFromText(
  graph: NotesGraph,
  page: DvPage,
  item: DvList,
): ParsedNode {
  const parsed = parseTokens(item.rawText)
  const location = {
    path: page.file.path,
    position: {
      start: { line: item.position.start.line, ch: item.position.start.col },
      end: { line: item.position.end.line, ch: item.position.end.col },
    },
  }

  const refs = graph.getObsidianLinkReferences(parsed)
  const ageDays = getAgeDays(page.file.mtime.ts, item.text)

  // Pure page reference — collapse to a virtual page/header node
  if (refs.length === 1 && refs[0].source === item.text) {
    return graph.createVirtualPage(refs[0], location, ageDays)
  }

  const searchKey = item.text.toLowerCase()
  const textNode: TextNode = {
    nodeType: "text",
    location,
    searchKey,
    parsedTokens: parsed,
    tags: item.tags,
    isTask: item.task,
    isCompleted: item.completed,
    boost: calculateBoost("text", searchKey, ageDays),
    ageDays,
  }

  graph.addOrUpdateNode(textNode)

  // Referenced pages become parents of the text node
  const refNodes = graph.createRefsNodes(refs, textNode, ageDays)
  for (const refNode of refNodes) {
    graph.addChild(refNode, textNode, textNode.location, page.file.mtime.ts)
  }

  return textNode
}

// ── createTreeFromTextLine ────────────────────────────────────────────────────

function createTreeFromTextLine(
  graph: NotesGraph,
  parentNode: ParsedNode,
  page: DvPage,
  item: DvList,
): ParsedNode {
  const createdNode = createNodeFromText(graph, page, item)

  const closestParentHeader = getClosestHeader(page.headers, item.position.start.line)

  if (item.parent === undefined && closestParentHeader) {
    const headerLocation = {
      path: page.file.path,
      position: {
        start: {
          line: closestParentHeader.position.start.line,
          ch: closestParentHeader.position.start.ch,
        },
        end: {
          line: closestParentHeader.position.end.line,
          ch: closestParentHeader.position.end.ch,
        },
      },
    }
    const header = graph.createHeaderNode(
      page.file.name,
      closestParentHeader.heading,
      headerLocation,
      -1,
      page.file.mtime.ts,
      page.file.name,
    )
    graph.addChild(header, createdNode, createdNode.location, 0)
  } else {
    graph.addChild(parentNode, createdNode, createdNode.location, page.file.mtime.ts)
  }

  return createdNode
}

function getClosestHeader(
  headers: DvPage["headers"],
  line: number,
): DvPage["headers"][number] | null {
  for (let i = headers.length - 1; i >= 0; i--) {
    if (headers[i].position.start.line <= line) return headers[i]
  }
  return null
}

// ── Header tree builder ───────────────────────────────────────────────────────

function createHeadersNodes(graph: NotesGraph, pageRef: ParsedNode, page: DvPage): void {
  function findParent(idx: number): DvPage["headers"][number] | null {
    const header = page.headers[idx]
    if (header.level === 1) return null
    for (let i = idx - 1; i >= 0; i--) {
      if (page.headers[i].level <= header.level - 1) return page.headers[i]
    }
    return null
  }

  for (let i = 0; i < page.headers.length; i++) {
    const h = page.headers[i]
    const location = {
      path: page.file.path,
      position: {
        start: { line: h.position.start.line, ch: h.position.start.ch },
        end: { line: h.position.end.line, ch: h.position.end.ch },
      },
    }
    const headerNode = graph.createHeaderNode(
      page.file.name,
      h.heading,
      location,
      h.level,
      page.file.mtime.ts,
      page.file.name,
    )

    const parent = findParent(i)
    if (parent) {
      const parentLocation = {
        path: page.file.path,
        position: {
          start: { line: parent.position.start.line, ch: parent.position.start.ch },
          end: { line: parent.position.end.line, ch: parent.position.end.ch },
        },
      }
      const parentNode = graph.createHeaderNode(
        page.file.name,
        parent.heading,
        parentLocation,
        parent.level,
        page.file.mtime.ts,
        page.file.name,
      )
      graph.addChild(parentNode, headerNode, location, page.file.mtime.ts)
    } else {
      graph.addChild(pageRef, headerNode, location, page.file.mtime.ts)
    }
  }
}

// ── indexSinglePage ───────────────────────────────────────────────────────────

export function indexSinglePage(
  page: DvPage,
  graph: NotesGraph,
  settings: IndexSettings,
): ParsedNode | undefined {
  const isArchived = (page.file.frontmatter["tags"] as string[] | undefined ?? []).includes(
    settings.archiveTag,
  )

  const aliases = page.file.aliases.values
  const tags = page.file.tags ?? []
  const searchKey = `${page.file.name}|${aliases.join(" ")}`.toLowerCase()
  const ageDays = getAgeDays(page.file.mtime.ts, page.file.name)

  const pageNode = {
    nodeType: "page" as const,
    isReference: false,
    page: page.file.name,
    aliases: Array.isArray(aliases) ? aliases : [],
    tags: Array.isArray(tags) ? tags : [],
    location: {
      path: page.file.path,
      position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } },
    },
    searchKey,
    boost: calculateBoost("page", searchKey, ageDays),
    ageDays,
  }

  graph.removeExistingPageEdges(pageNode)
  graph.addOrUpdateNode(pageNode)

  // Parent relations from frontmatter
  let parents = page.file.frontmatter[settings.parentRelation] ?? []
  if (typeof parents === "string") parents = [parents]
  for (const parent of parents as string[]) {
    const refs = graph.getObsidianLinkReferences(parseTokens(parent))
    if (refs.length === 0) continue
    const refNode = graph.createVirtualPage(refs[0], pageNode.location, getAgeDays(page.file.mtime.ts))
    graph.addChild(refNode, pageNode, pageNode.location, page.file.mtime.ts)
  }

  if (isArchived) return undefined

  createHeadersNodes(graph, pageNode, page)

  const lineArchiveTag = "#" + settings.archiveTag

  function createSubtree(parent: ParsedNode, children: DvList[]): void {
    for (const child of children) {
      child.text = child.text.trim()
      if (shouldSkip(child, lineArchiveTag)) continue
      const created = createTreeFromTextLine(graph, parent, page, child)
      createSubtree(created, child.children)
    }
  }

  createSubtree(pageNode, page.file.lists.values.filter(it => it.parent === undefined))

  return pageNode
}
