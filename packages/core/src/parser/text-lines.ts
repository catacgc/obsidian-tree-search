import type { HeaderNode, Location, PageNode, ParsedNode, ParsedTextToken, TextNode } from "../graph/types.ts"
import type { NotesGraph } from "../graph/graph.ts"
import { getKey } from "../graph/graph.ts"
import { calculateBoost, ageDaysFromText, UNDATED_AGE } from "../graph/boost.ts"
import { parseTokens, stripUrlQueryStrings } from "./inline-tokens.ts"
import type { NodeTextLine } from "./canvas.ts"

/**
 * Recursively create graph nodes from a NodeTextLine tree, parenting each to
 * its parent line's graph node (or to pageNode for roots).
 *
 * Returns the graph key of the first node created (used for canvas edge wiring).
 * The optional onFirstKey callback is called with (key, canvasNodeId) for each
 * first node created from a canvas node block.
 */
export function buildNodesFromTextLines(
  lines: NodeTextLine[],
  pageNode: PageNode,
  graph: NotesGraph,
  onFirstKey?: (key: string, canvasNodeId: string | undefined) => void,
  parseTokensFn: (text: string) => ParsedTextToken[] = parseTokens,
): string | undefined {
  let firstKey: string | undefined

  for (const line of lines) {
    const node = createNodeForLine(pageNode, line, graph, parseTokensFn)
    const key = getKey(node)
    graph.addOrUpdateNode(node)

    if (firstKey === undefined) {
      firstKey = key
      onFirstKey?.(key, line.location.canvasNode)
    }

    const parent = line.parent
      ? createNodeForLine(pageNode, line.parent, graph, parseTokensFn)
      : pageNode

    graph.addChild(parent, node, node.location, 0)
  }

  return firstKey
}

function createNodeForLine(
  pageNode: PageNode,
  line: NodeTextLine,
  graph: NotesGraph,
  parseTokensFn: (text: string) => ParsedTextToken[],
): ParsedNode {
  const pageArchived = pageNode.archived === true
  if (line.type === "header") {
    return createHeaderNode(pageNode.page, line.text, line.location, line.indent, pageArchived)
  }
  return createTextNode(graph, line.text, line.location, line.task === "task" || line.task === "completed", line.task === "completed", pageNode.ageDays, parseTokensFn, pageArchived)
}

function createHeaderNode(
  page: string,
  header: string,
  location: Location,
  indent: number,
  archived: boolean,
): HeaderNode {
  const searchKey = `${page}#${header}`.toLowerCase()
  const ageDays = ageDaysFromText(header) ?? UNDATED_AGE
  return {
    nodeType: "header",
    page,
    header,
    indent,
    location,
    searchKey,
    boost: calculateBoost("header", searchKey, ageDays),
    ageDays,
    ...(archived ? { archived: true } : {}),
  }
}

function createTextNode(
  graph: NotesGraph,
  text: string,
  location: Location,
  isTask: boolean,
  isCompleted: boolean,
  inheritedAge: number,
  parseTokensFn: (text: string) => ParsedTextToken[],
  pageArchived: boolean,
): ParsedNode {
  // A date in the line's own text overrides the inherited (page) age.
  const ageDays = ageDaysFromText(text) ?? inheritedAge
  const parsed = parseTokensFn(text)
  const refs = graph.getObsidianLinkReferences(parsed)

  // Pure page reference: collapse to virtual page
  if (refs.length === 1 && refs[0].source === text) {
    return graph.createVirtualPage(refs[0], location, ageDays)
  }

  const searchKey = stripUrlQueryStrings(text).toLowerCase()
  const archived =
    pageArchived ||
    parsed.some(t => t.tokenType === "meta_mdtree" && t.directive === "archive")
  const textNode: TextNode = {
    nodeType: "text",
    location,
    searchKey,
    parsedTokens: parsed,
    tags: [],
    isTask,
    isCompleted,
    boost: calculateBoost("text", searchKey, ageDays),
    ageDays,
    ...(archived ? { archived: true } : {}),
  }

  graph.addOrUpdateNode(textNode)

  // Virtual pages referenced in text become parents of the text node
  const refNodes = graph.createRefsNodes(refs, textNode, ageDays)
  for (const refNode of refNodes) {
    graph.addChild(refNode, textNode, textNode.location, ageDays, true)
  }

  return textNode
}
