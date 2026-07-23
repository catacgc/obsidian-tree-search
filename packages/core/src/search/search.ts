import type { NotesGraph } from "../graph/graph.ts"
import type { ParsedNode } from "../graph/types.ts"
import { firstPassInclude, matchQuery, parseQuery, type QueryExpr } from "./query.ts"

export type ResultNode = {
  node: ParsedNode
  children: ResultNode[]
  parents: string[]
}

// ── Tree builder ──────────────────────────────────────────────────────────────

function buildTree(
  nodeKey: string,
  graph: NotesGraph,
  roots: Map<string, ResultNode>,
  traversed: Set<string>,
): ResultNode {
  traversed.add(nodeKey)

  const newNode: ResultNode = {
    children: [],
    node: graph.getNodeAttributes(nodeKey),
    parents: [],
  }

  for (const edge of graph.outboundEdgeEntries(nodeKey)) {
    let childNode: ResultNode | null = null

    if (roots.has(edge.target)) {
      childNode = roots.get(edge.target)!
      roots.delete(edge.target)
    }

    if (traversed.has(edge.edge)) continue
    traversed.add(edge.edge)

    if (!childNode) {
      childNode = buildTree(edge.target, graph, roots, traversed)
    }

    childNode.node = { ...childNode.node, ...{ location: edge.attributes.location } }
    childNode.parents.push(newNode.node.location.path)
    newNode.children.push(childNode)
  }

  return newNode
}

// ── Filter helpers ────────────────────────────────────────────────────────────

function filterTreeByWord(
  node: ResultNode,
  expr: QueryExpr,
  pruneMatchingTree = false,
): ResultNode | null {
  const nodeMatches = matchQuery(node.node, expr)

  if (!nodeMatches && pruneMatchingTree) return null
  if (nodeMatches && !pruneMatchingTree) return node  // matched: keep entire subtree

  const matchingChildren = node.children
    .map(child => filterTreeByWord(child, expr, pruneMatchingTree))
    .filter((c): c is ResultNode => c !== null)

  if (!nodeMatches && matchingChildren.length === 0) return null

  return { ...node, children: matchingChildren }
}

export function pruneResultTree(
  nodes: ResultNode[],
  keep: (node: ParsedNode) => boolean,
): ResultNode[] {
  const result: ResultNode[] = []
  for (const node of nodes) {
    const children = pruneResultTree(node.children, keep)
    if (keep(node.node)) {
      result.push({ ...node, children })
    } else {
      result.push(...children) // drop node, promote kept descendants
    }
  }
  return result
}

function isNegation(expr: QueryExpr): boolean {
  return (
    expr.type === "not" ||
    (expr.type === "and" && expr.exprs.every(isNegation))
  )
}

function filterDown(results: ResultNode[], search: QueryExpr[]): ResultNode[] {
  if (search.length === 0) return results
  const expr = search[0]
  const pruneMatchingTree = isNegation(expr)

  const filtered = results
    .map(r => filterTreeByWord(r, expr, pruneMatchingTree))
    .filter((r): r is ResultNode => r !== null)

  return filterDown(filtered, search.slice(1))
}

// ── Public API ────────────────────────────────────────────────────────────────

export function searchIndex(
  graph: NotesGraph,
  qs: string,
  separator: string,
): ResultNode[] {
  if (qs.length < 3) return []

  const expressions = parseQuery(qs, separator)

  const roots = new Map<string, ResultNode>()
  const firstPass = expressions[0]

  const firstPageCandidates = graph
    .filterNodes((_, attrs) => attrs.nodeType !== "pointer" && firstPassInclude(attrs, firstPass))
    .sort((a, b) => b.length - a.length)

  const traversed = new Set<string>()

  for (const nodeKey of firstPageCandidates) {
    if (roots.has(nodeKey) || traversed.has(nodeKey)) continue
    const newNode = buildTree(nodeKey, graph, roots, traversed)
    roots.set(nodeKey, newNode)
  }

  return filterDown(Array.from(roots.values()), expressions.slice(1)).sort(
    (a, b) => b.children.length - a.children.length,
  )
}

export function advancedSearch(
  graph: NotesGraph,
  exactRef: string,
  query: string,
  separator: string,
): ResultNode[] {
  const nodeKey = exactRef.toLowerCase()
  if (!graph.hasNode(nodeKey)) return []

  const tree = buildTree(nodeKey, graph, new Map(), new Set())

  if (!query) return tree.children

  const expressions = parseQuery(query, separator)

  return filterDown(tree.children, expressions)
}

export function searchParents(graph: NotesGraph, basename: string): ResultNode[] {
  const nodeKey = `[[${basename.toLowerCase()}]]`
  if (!graph.hasNode(nodeKey)) return []

  return graph.inboundEdgeEntries(nodeKey).map(edge => ({
    node: { ...graph.getNodeAttributes(edge.source), location: edge.attributes.location },
    children: [],
    parents: [],
  }))
}

export function flattenTasks(nodes: ResultNode[]): ResultNode[] {
  const result: ResultNode[] = []
  function walk(children: ResultNode[]): void {
    for (const node of children) {
      if (
        node.node.nodeType === "text" &&
        node.node.isTask &&
        !node.node.isCompleted
      ) {
        result.push(node)
      }
      walk(node.children)
    }
  }
  walk(nodes)
  return result
}
