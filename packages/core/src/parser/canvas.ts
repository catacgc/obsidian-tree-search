import type { Location, PageNode, ParsedTextToken } from "../graph/types.ts"
import type { NotesGraph } from "../graph/graph.ts"
import { calculateBoost, UNDATED_AGE } from "../graph/boost.ts"
import { buildNodesFromTextLines } from "./text-lines.ts"

// ── Canvas JSON types ─────────────────────────────────────────────────────────

type CanvasBox = { x: number; y: number; width: number; height: number }

type CanvasNode = {
  id: string
  type: "text" | "file" | "link" | "group"
  color?: string
  text?: string
  file?: string
  subpath?: string
  url?: string
  label?: string
} & CanvasBox

type CanvasEdge = {
  id: string
  fromNode: string
  fromSide: "top" | "right" | "bottom" | "left"
  toNode: string
  toSide: "top" | "right" | "bottom" | "left"
  color?: string
  label?: string
}

export type CanvasData = {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

// ── NodeTextLine (shared with text-lines.ts) ──────────────────────────────────

export type NodeTextLine = {
  text: string
  location: Location
  box: CanvasBox
  parent?: NodeTextLine
  type: "header" | "list"
  task?: "task" | "completed"
  indent: number
}

// ── Filter ────────────────────────────────────────────────────────────────────

function shouldInclude(text: string): boolean {
  return (
    text.includes("[[") ||
    text.includes("http") ||
    text.includes("![[") ||
    text.includes("#") ||
    text.includes("- [")
  )
}

// ── Parse a single canvas node into NodeTextLine[] ────────────────────────────

function parseCanvasNode(node: CanvasNode, path: string): NodeTextLine[] {
  if (node.type === "file") {
    const basename = node.file?.split("/").pop()?.replace(".md", "")
    return [
      {
        text: `[[${basename}${node.subpath ?? ""}]]`,
        location: {
          path,
          position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } },
          canvasNode: node.id,
        },
        box: { x: node.x, y: node.y, width: node.width, height: node.height },
        type: "list",
        indent: 1,
      },
    ]
  }

  if (node.type === "group") {
    if (!node.label) return []
    return [
      {
        text: node.label,
        location: {
          path,
          position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } },
          canvasNode: node.id,
        },
        box: { x: node.x, y: node.y, width: node.width, height: node.height },
        type: "header",
        indent: 1,
      },
    ]
  }

  if (!node.text) return []

  return node.text
    .split("\n")
    .filter(shouldInclude)
    .map((line, index): NodeTextLine | null => {
      const headerMatch = line.match(/^(#+)\s*(.*)/)
      const listItemMatch = line.match(/^\s*(-|\*|\d+\.)\s+(.*)/)

      if (!headerMatch && !listItemMatch) return null

      let effectiveIndent = 0
      let task: NodeTextLine["task"] = undefined

      if (listItemMatch) {
        const trimmed = line.trimStart()
        effectiveIndent = line.length - trimmed.length
        const content = listItemMatch[2]
        if (content.startsWith("[ ]") || content.startsWith("[x]")) {
          task = content.startsWith("[x]") ? "completed" : "task"
        }
      }

      if (headerMatch) {
        effectiveIndent = headerMatch[1].length
      }

      return {
        text: line.replace(/^([#\-\s])+/, "").trim(),
        location: {
          path,
          position: {
            start: { line: index, ch: 0 },
            end: { line: index, ch: line.length },
          },
          canvasNode: node.id,
        },
        box: { x: node.x, y: node.y, width: node.width, height: node.height },
        type: headerMatch ? "header" : "list",
        indent: effectiveIndent,
        task,
      }
    })
    .filter((l): l is NodeTextLine => l !== null)
}

// ── Group-parent assignment ───────────────────────────────────────────────────

function addGroupParents(
  nodes: { block: CanvasNode; lines: NodeTextLine[] }[],
): { block: CanvasNode; lines: NodeTextLine[] }[] {
  for (const node of nodes) {
    const groupParent = nodes.find(candidate => {
      if (candidate.block.type !== "group") return false
      const g = candidate.block
      return (
        g.x < node.block.x &&
        g.x + g.width > node.block.x + node.block.width &&
        g.y < node.block.y &&
        g.y + g.height > node.block.y + node.block.height
      )
    })
    node.lines = addParentsWithinNode(node.lines, groupParent?.lines[0])
  }
  return nodes
}

function addParentsWithinNode(
  lines: NodeTextLine[],
  groupParent?: NodeTextLine,
): NodeTextLine[] {
  const headerStack: NodeTextLine[] = []
  const lineStack: NodeTextLine[] = []

  for (const line of lines) {
    if (line.type === "header") {
      while (headerStack.length > 0 && headerStack[headerStack.length - 1].indent >= line.indent) {
        headerStack.pop()
      }
      line.parent = headerStack[headerStack.length - 1] ?? groupParent
      headerStack.push(line)
      continue
    }

    while (lineStack.length > 0 && lineStack[lineStack.length - 1].indent >= line.indent) {
      lineStack.pop()
    }

    const parentNode =
      lineStack.length === 0 && headerStack.length > 0
        ? headerStack[headerStack.length - 1]
        : lineStack[lineStack.length - 1]

    line.parent = parentNode ?? groupParent
    lineStack.push(line)
  }

  return lines
}

// ── Main canvas parser ────────────────────────────────────────────────────────

export function parseCanvasData(
  path: string,
  basename: string,
  canvasData: CanvasData,
  graph: NotesGraph,
  parseTokensFn?: (text: string) => ParsedTextToken[],
): NotesGraph {
  const pageNode = createCanvasPageNode(path, basename, graph)

  const parsed = canvasData.nodes.map(node => ({
    block: node,
    lines: parseCanvasNode(node, path),
  }))

  const withParents = addGroupParents(parsed)

  // canvasNodeId → first graph node key created from that canvas node (for edge wiring)
  const canvasRootMap = new Map<string, string>()

  for (const node of withParents) {
    buildNodesFromTextLines(node.lines, pageNode, graph, (key, canvasNodeId) => {
      if (canvasNodeId && !canvasRootMap.has(canvasNodeId)) {
        canvasRootMap.set(canvasNodeId, key)
      }
    }, parseTokensFn)
    // fallback: if the canvas node produced no lines, its id still needs mapping
    if (node.block.id && !canvasRootMap.has(node.block.id)) {
      canvasRootMap.set(node.block.id, `[[${pageNode.page.toLowerCase()}]]`)
    }
  }

  // Pass 3: wire canvas edges as "related" graph edges
  const location: Location = {
    path,
    position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } },
  }
  for (const edge of canvasData.edges) {
    const fromKey = canvasRootMap.get(edge.fromNode)
    const toKey = canvasRootMap.get(edge.toNode)
    if (fromKey && toKey && graph.hasNode(fromKey) && graph.hasNode(toKey)) {
      graph.addRelatedEdge(fromKey, toKey, location)
    }
  }

  return graph
}

function createCanvasPageNode(path: string, basename: string, graph: NotesGraph): PageNode {
  const displayName = `${basename}.canvas`
  const searchKey = displayName.toLowerCase()
  const node: PageNode = {
    nodeType: "page",
    isReference: false,
    page: displayName,
    aliases: [],
    tags: [],
    location: {
      path,
      position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } },
    },
    searchKey,
    boost: calculateBoost("page", searchKey, UNDATED_AGE),
    ageDays: UNDATED_AGE,
  }
  graph.removeExistingPageEdges(node)
  graph.addOrUpdateNode(node)
  return node
}
