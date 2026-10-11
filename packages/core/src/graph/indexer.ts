import type { DvList, DvPage, HeaderNode, ParsedNode, ParsedTextToken, TextNode } from "./types.ts"
import type { NotesGraph } from "./graph.ts"
import { getKey } from "./graph.ts"
import { calculateBoost, getAgeDays, ageDaysFromText, deadlineDate, isUndated } from "./boost.ts"
import { parseTokens, stripUrlQueryStrings } from "../parser/inline-tokens.ts"
import { extractPageDate } from "../parser/frontmatter.ts"
import { textSourceDate } from "../search/relative-date.ts"
import { CREATED_FIELD_RE, isProseText } from "../parser/list-scanner.ts"

export type IndexSettings = {
  parentRelation: string // default: "parent"
  archiveTag: string // default: "archive"
  searchSeparator: string // default: "."
  // Optional resolver mapping a vault-relative path to a daily/weekly note's
  // date (ms epoch), or null when the path is not a periodic note. Injected by
  // the runtime (Obsidian / CLI) since it needs a moment parser; undefined in
  // DEFAULT_SETTINGS, which makes all periodic notes fall through to undated.
  periodicDate?: (path: string) => number | null
}

export const DEFAULT_SETTINGS: IndexSettings = {
  parentRelation: "parent",
  archiveTag: "archive",
  searchSeparator: ".",
}

// ── shouldSkip ────────────────────────────────────────────────────────────────

function shouldSkip(lst: DvList): boolean {
  if (lst.section.subpath) {
    const header = lst.section.subpath.replace(/#/g, " ").trim()
    if (header.startsWith("--") && header.endsWith("--")) return true
  }
  if (lst.task) return false

  if (lst.tags.length > 0) return false

  // If meta-actions were stripped (rawText !== text), don't skip — we have parsedTokens to render
  if (lst.rawText !== lst.text) return false

  if (CREATED_FIELD_RE.test(lst.text)) return false

  return isProseText(lst.text)
}

// ── createNodeFromText ────────────────────────────────────────────────────────

function createNodeFromText(
  graph: NotesGraph,
  page: DvPage,
  item: DvList,
  pageAge: number,
  parseTokensFn: (text: string) => ParsedTextToken[],
  forceArchived: boolean,
): ParsedNode {
  const parsed = item.precomputedTokens ?? parseTokensFn(item.rawText)
  const location = {
    path: page.file.path,
    position: {
      start: { line: item.position.start.line, ch: item.position.start.col },
      end: { line: item.position.end.line, ch: item.position.end.col },
    },
  }

  const refs = graph.getObsidianLinkReferences(parsed)
  // A date in the line's own text overrides the page's date; otherwise the node
  // inherits the page's age (which may be UNDATED_AGE).
  const ageDays = ageDaysFromText(item.text) ?? pageAge

  // Pure page reference — collapse to a virtual page/header node
  if (refs.length === 1 && refs[0].source === item.text) {
    return graph.createVirtualPage(refs[0], location, ageDays)
  }

  const searchKey = stripUrlQueryStrings(item.text).toLowerCase()
  // Intrinsic archive: `forceArchived` (a line `#archive` tag, or the line
  // living inside a frontmatter-archived page) or a `(meta-mdtree:: archive)`
  // directive. Previously any of these skipped the line at index time; now it is
  // indexed and marked, so it can be hidden (default) or revealed via
  // `is:archived`. Descendant propagation is applied path-contextually at query
  // time, not here (nodes are content-keyed and may have multiple parents).
  const archived =
    forceArchived ||
    parsed.some(t => t.tokenType === "meta_mdtree" && t.directive === "archive")
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
    ...(archived ? { archived: true } : {}),
  }

  graph.addOrUpdateNode(textNode)
  graph.trackNodePath(getKey(textNode), page.file.path)

  // Referenced pages become parents of the text node
  const refNodes = graph.createRefsNodes(refs, textNode, ageDays)
  for (const refNode of refNodes) {
    graph.addChild(refNode, textNode, textNode.location, page.file.mtime.ts, true)
  }

  return textNode
}

// ── createTreeFromTextLine ────────────────────────────────────────────────────

function createTreeFromTextLine(
  graph: NotesGraph,
  parentNode: ParsedNode,
  page: DvPage,
  item: DvList,
  pageAge: number,
  parseTokensFn: (text: string) => ParsedTextToken[],
  forceArchived: boolean,
): ParsedNode {
  const createdNode = createNodeFromText(graph, page, item, pageAge, parseTokensFn, forceArchived)

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
      pageAge,
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

function createHeadersNodes(graph: NotesGraph, pageRef: ParsedNode, page: DvPage, pageAge: number, archived: boolean): void {
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
      pageAge,
      archived,
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
        pageAge,
        archived,
      )
      graph.addChild(parentNode, headerNode, location, page.file.mtime.ts)
    } else {
      graph.addChild(pageRef, headerNode, location, page.file.mtime.ts)
    }
  }
}

// ── finishTextNode ────────────────────────────────────────────────────────────

/** Sets `nested` (parent is a text line), `list` (has text children) and, when an open-task child carries a
 *  scheduled/due date (or a child itself inherited one) earlier than its own date, or it has none, inherits that
 *  child's `ageDays` + `inheritedDate`. Other dates (`[created::]`, a date in the text) are not deadlines and are
 *  never inherited. Re-stores the node and returns the stored copy. */
function finishTextNode(graph: NotesGraph, node: TextNode, parent: ParsedNode, kids: ParsedNode[]): TextNode {
  const textKids = kids.filter((k): k is TextNode => k.nodeType === "text")
  const next: TextNode = { ...node }
  if (parent.nodeType === "text") next.nested = true
  if (textKids.length > 0) next.list = true
  const dated = textKids
    .map(k => ({ age: k.ageDays, date: k.inheritedDate ?? (k.isTask && !k.isCompleted ? deadlineDate(k.searchKey) : null) }))
    .filter((d): d is { age: number; date: string } => d.date !== null && !isUndated(d.age))
  if (dated.length > 0) {
    const earliest = dated.reduce((a, b) => (b.age > a.age ? b : a))
    if (textSourceDate(node) === null || earliest.age > node.ageDays) {
      next.ageDays = earliest.age
      next.inheritedDate = earliest.date
      next.boost = calculateBoost("text", next.searchKey, earliest.age)
    }
  }
  graph.addOrUpdateNode(next)
  return next
}

// ── indexSinglePage ───────────────────────────────────────────────────────────

export function indexSinglePage(
  page: DvPage,
  graph: NotesGraph,
  settings: IndexSettings,
  parseTokensFn: (text: string) => ParsedTextToken[] = parseTokens,
): ParsedNode | undefined {
  const isArchivedPage = (page.file.frontmatter["tags"] as string[] | undefined ?? []).includes(
    settings.archiveTag,
  )

  const aliases = page.file.aliases.values
  const tags = page.file.tags ?? []
  const searchKey = `${page.file.name}|${aliases.join(" ")}`.toLowerCase()
  // Page date precedence: a date in the filename, else frontmatter
  // `updated`/`created`, else a parsed daily/weekly-note date, else undated.
  // Filesystem mtime is intentionally ignored.
  const pageDate = extractPageDate(page.file.frontmatter) ?? settings.periodicDate?.(page.file.path) ?? null
  const ageDays = getAgeDays(page.file.name, pageDate)

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
    ...(isArchivedPage ? { archived: true } : {}),
  }

  graph.removeExistingPageEdges(pageNode)
  graph.addOrUpdateNode(pageNode)

  // Parent relations from frontmatter
  let parents = page.file.frontmatter[settings.parentRelation] ?? []
  if (typeof parents === "string") parents = [parents]
  for (const parent of parents as string[]) {
    const refs = graph.getObsidianLinkReferences(
      page.precomputedParentTokens?.get(parent) ?? parseTokensFn(parent)
    )
    if (refs.length === 0) continue
    const refNode = graph.createVirtualPage(refs[0], pageNode.location, ageDays)
    graph.addChild(refNode, pageNode, pageNode.location, page.file.mtime.ts)
  }

  // Archived pages are no longer excluded from the index: their body is indexed
  // and marked archived (below, via `forceArchived`) so it is hidden by default
  // but revealable with `is:archived`.
  createHeadersNodes(graph, pageNode, page, ageDays, isArchivedPage)

  const lineArchiveTag = "#" + settings.archiveTag

  function createSubtree(parent: ParsedNode, children: DvList[]): ParsedNode[] {
    const created: ParsedNode[] = []
    for (const child of children) {
      child.text = child.text.trim()
      if (shouldSkip(child)) continue
      // A line is intrinsically archived if it carries the `#archive` tag or the
      // whole page is archived (frontmatter tag); the directive form is detected
      // from tokens inside createNodeFromText.
      const forceArchived = isArchivedPage || child.tags.includes(lineArchiveTag)
      const node = createTreeFromTextLine(graph, parent, page, child, ageDays, parseTokensFn, forceArchived)
      const kids = createSubtree(node, child.children)
      created.push(node.nodeType === "text" ? finishTextNode(graph, node, parent, kids) : node)
    }
    return created
  }

  createSubtree(pageNode, page.file.lists.values.filter(it => it.parent === undefined))

  return pageNode
}
