import type { HeaderNode, Location, PageNode, ParsedNode, ParsedTextToken, TextNode } from "../graph/types.ts"
import type { NotesGraph } from "../graph/graph.ts"
import { getKey } from "../graph/graph.ts"
import { calculateBoost } from "../graph/boost.ts"
import { parseTokens } from "./inline-tokens.ts"
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
  if (line.type === "header") {
    return createHeaderNode(pageNode.page, line.text, line.location, line.indent)
  }
  return createTextNode(graph, line.text, line.location, line.task === "task" || line.task === "completed", line.task === "completed", pageNode.ageDays, parseTokensFn)
}

function createHeaderNode(
  page: string,
  header: string,
  location: Location,
  indent: number,
): HeaderNode {
  const searchKey = `${page}#${header}`.toLowerCase()
  return {
    nodeType: "header",
    page,
    header,
    indent,
    location,
    searchKey,
    boost: calculateBoost("header", searchKey, 0),
    ageDays: 0,
  }
}

function createTextNode(
  graph: NotesGraph,
  text: string,
  location: Location,
  isTask: boolean,
  isCompleted: boolean,
  ageDays: number,
  parseTokensFn: (text: string) => ParsedTextToken[],
): ParsedNode {
  const parsed = parseTokensFn(text)
  const refs = graph.getObsidianLinkReferences(parsed)

  // Pure page reference: collapse to virtual page
  if (refs.length === 1 && refs[0].source === text) {
    return graph.createVirtualPage(refs[0], location, ageDays)
  }

  const textNode: TextNode = {
    nodeType: "text",
    location,
    searchKey: text.toLowerCase(),
    parsedTokens: parsed,
    tags: [],
    isTask,
    isCompleted,
    boost: calculateBoost("text", text.toLowerCase(), ageDays),
    ageDays,
  }

  graph.addOrUpdateNode(textNode)

  // Virtual pages referenced in text become parents of the text node
  const refNodes = graph.createRefsNodes(refs, textNode, ageDays)
  for (const refNode of refNodes) {
    graph.addChild(refNode, textNode, textNode.location, ageDays)
  }

  return textNode
}
