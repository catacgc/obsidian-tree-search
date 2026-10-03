import { linkTargetKeys, type NotesGraph } from "../graph/graph.ts"
import type { EdgeEntry, ParsedNode } from "../graph/types.ts"
import { firstPassInclude, matchQuery, parseQuery, extractArchiveReveal, extractScope, queryTargetsFolders, DAILY_NOTE, type ScopeTarget, type QueryExpr } from "./query.ts"
import { partitionArchived } from "./archive.ts"

export type ResultNode = {
  node: ParsedNode
  children: ResultNode[]
  parents: string[]
  // Set by `partitionArchived` when revealing: true if this node is archived or
  // sits under an archived ancestor in this result tree. Drives grey rendering.
  effectiveArchived?: boolean
}

/** Runtime context a query can refer to but the graph can't name. */
export type SearchOptions = {
  /** Vault path of today's daily note: the target of `:daily`. Unset, `:daily` matches nothing. */
  dailyNote?: string
}

// ── Tree builder ──────────────────────────────────────────────────────────────

type EdgeFilter = (edge: EdgeEntry) => boolean

// Folder-containment edges are only followed when the query targets folders,
// so folder trees stay out of ordinary searches.
const skipFolderEdges: EdgeFilter = edge => edge.attributes.type !== "folder"

function buildTree(
  nodeKey: string,
  graph: NotesGraph,
  roots: Map<string, ResultNode>,
  traversed: Set<string>,
  follow: EdgeFilter = skipFolderEdges,
): ResultNode {
  traversed.add(nodeKey)

  const newNode: ResultNode = {
    children: [],
    node: graph.getNodeAttributes(nodeKey),
    parents: [],
  }

  for (const edge of graph.outboundEdgeEntries(nodeKey)) {
    if (!follow(edge)) continue

    let childNode: ResultNode | null = null

    if (roots.has(edge.target)) {
      childNode = roots.get(edge.target)!
      roots.delete(edge.target)
    }

    if (traversed.has(edge.edge)) continue
    traversed.add(edge.edge)

    if (!childNode) {
      childNode = buildTree(edge.target, graph, roots, traversed, follow)
    }

    childNode.node = { ...childNode.node, ...{ location: edge.attributes.location } }
    childNode.parents.push(newNode.node.location.path)
    newNode.children.push(childNode)
  }

  return newNode
}

// ── Outline / tree scope ──────────────────────────────────────────────────────
//
// `outline:<note>` keeps a search inside a note's own outline: its headings and
// bullets as written in that file, without following links out of it. An
// outline edge is a "parent" edge recorded in that file, minus the edges the
// indexer adds from every page/header a line links to (same location as the
// line): those make the line a child of the linked note, not of its outline
// parent. A line nested under a bullet that links the same note shares that
// edge (edges are unique per pair), so it is dropped too, as in `fileParent`.
//
// `tree:<note>` keeps it inside the note's full subtree: every edge the search
// would follow anyway, recorded in any file, so children written elsewhere
// under a `[[note]]` link count too. Several scopes intersect.

type Scope = { keys: Set<string>; follow: EdgeFilter }

type NoteCandidate = { key: string; name: string; path: string; lowerPath: string; ageDays: number; isReference: boolean }

/** The notes `outline:`/`tree:` targets name, compared lowercase:
 *  - `:daily`: today's daily note (`SearchOptions.dailyNote`), by path;
 *  - exact (quoted): every note whose name or vault path (with or without `.md`) equals it;
 *  - a fragment: the note whose name equals it, else the most recent one whose name
 *    (or, for a fragment with a `/`, vault path) contains it.
 *  With `includeReferences`, link-only notes are candidates too; they match by name
 *  only, since their `location.path` is the file that links to them. */
function pickNotes(graph: NotesGraph, targets: ScopeTarget[], options: SearchOptions, includeReferences: boolean): NoteCandidate[] {
  const notes: NoteCandidate[] = []
  graph.filterNodes((key, attrs) => {
    if (attrs.nodeType === "page" && (includeReferences || !attrs.isReference)) {
      const path = attrs.location.path
      notes.push({
        key, name: attrs.page.toLowerCase(), path, lowerPath: path.toLowerCase(), ageDays: attrs.ageDays,
        isReference: attrs.isReference === true,
      })
    }
    return false
  })

  const picked = new Map<string, NoteCandidate>()
  for (const t of targets) {
    const v = (t.value === DAILY_NOTE ? options.dailyNote ?? "" : t.value).toLowerCase()
    if (!v) continue
    if (t.exact) {
      for (const n of notes) {
        if (n.name === v || (!n.isReference && (n.lowerPath === v || n.lowerPath.replace(/\.md$/, "") === v))) {
          picked.set(n.key, n)
        }
      }
      continue
    }
    const named = notes.find(n => n.name === v)
    if (named) {
      picked.set(named.key, named)
      continue
    }
    // Newest first: the note's own date (ageDays), then its file's mtime (carried by
    // the edges recorded in that file), then path for a stable pick.
    const latest = notes
      .filter(n => v.includes("/") ? !n.isReference && n.lowerPath.includes(v) : n.name.includes(v))
      .map(n => ({
        n,
        mtime: graph.outboundEdgeEntries(n.key)
          .reduce((max, e) => e.attributes.location.path === n.path ? Math.max(max, e.attributes.mtime) : max, 0),
      }))
      .sort((a, b) => a.n.ageDays - b.n.ageDays || b.mtime - a.mtime || a.n.path.localeCompare(b.n.path))[0]
    if (latest) picked.set(latest.n.key, latest.n)
  }
  return Array.from(picked.values())
}

/** Keys reachable from `roots` along `follow`, roots included. */
function reachable(graph: NotesGraph, roots: string[], follow: EdgeFilter): Set<string> {
  const keys = new Set<string>()
  const stack = [...roots]
  while (stack.length > 0) {
    const key = stack.pop()!
    if (keys.has(key)) continue
    keys.add(key)
    for (const edge of graph.outboundEdgeEntries(key)) if (follow(edge)) stack.push(edge.target)
  }
  return keys
}

function outlineScope(graph: NotesGraph, targets: ScopeTarget[], options: SearchOptions): Scope {
  const paths = new Set(pickNotes(graph, targets, options, false).map(n => n.path))
  const follow: EdgeFilter = edge => {
    if (edge.attributes.type !== "parent" || !paths.has(edge.attributes.location.path)) return false
    const target = graph.getNodeAttributes(edge.target)
    return target.nodeType !== "text" || !linkTargetKeys(target.parsedTokens).has(edge.source)
  }
  const roots = graph
    .filterNodes((_, attrs) => attrs.nodeType === "page" && !attrs.isReference && paths.has(attrs.location.path))
  return { keys: reachable(graph, roots, follow), follow }
}

function treeScope(graph: NotesGraph, targets: ScopeTarget[], options: SearchOptions, follow: EdgeFilter): Scope {
  const roots = pickNotes(graph, targets, options, true).map(n => n.key)
  return { keys: reachable(graph, roots, follow), follow }
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
  options: SearchOptions = {},
): ResultNode[] {
  if (qs.length < 3) return []

  // Strip `is:archived` out of the matching stages (it is a visibility toggle,
  // not a matcher) so it never filters results; a bare `is:archived` stage is
  // substituted with the archived predicate so it still selects archived nodes.
  // `outline:`/`tree:` likewise leave the stages: they scope the candidates and edges.
  const { outline, tree, stages: expressions } =
    extractScope(extractArchiveReveal(parseQuery(qs, separator)).stages)
  const baseFollow: EdgeFilter = queryTargetsFolders(expressions) ? () => true : skipFolderEdges
  const scopes: Scope[] = [
    ...(outline.length > 0 ? [outlineScope(graph, outline, options)] : []),
    ...(tree.length > 0 ? [treeScope(graph, tree, options, baseFollow)] : []),
  ]
  const follow: EdgeFilter = scopes.length === 0 ? baseFollow : edge => scopes.every(s => s.follow(edge))

  const roots = new Map<string, ResultNode>()
  const firstPass = expressions[0]

  const firstPageCandidates = graph
    .filterNodes((key, attrs) =>
      attrs.nodeType !== "pointer" && scopes.every(s => s.keys.has(key)) && firstPassInclude(attrs, firstPass))
    .sort((a, b) => b.length - a.length)

  const traversed = new Set<string>()

  for (const nodeKey of firstPageCandidates) {
    if (roots.has(nodeKey) || traversed.has(nodeKey)) continue
    const newNode = buildTree(nodeKey, graph, roots, traversed, follow)
    roots.set(nodeKey, newNode)
  }

  return filterDown(Array.from(roots.values()), expressions.slice(1)).sort(
    (a, b) => b.children.length - a.children.length,
  )
}

/**
 * Link targets for Insert Link and the editor's autocomplete: only page and
 * header nodes whose own key matches every query term (ANDed across stages,
 * regardless of hierarchy boundaries), with archived rows hidden.
 */
export function linkTargetTree(graph: NotesGraph, query: string, separator: string): ResultNode[] {
  const expr: QueryExpr = { type: "and", exprs: parseQuery(query, separator) }
  const pruned = pruneResultTree(
    searchIndex(graph, query, separator),
    n => (n.nodeType === "page" || n.nodeType === "header") && matchQuery(n, expr),
  )
  return partitionArchived(pruned, false).visible
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

  // Strip `is:archived` from matching (it is a visibility toggle handled by
  // partitionArchived, not a matcher).
  const { stages: expressions } = extractArchiveReveal(parseQuery(query, separator))

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
