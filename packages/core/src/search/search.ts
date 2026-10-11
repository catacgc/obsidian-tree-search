import { getKey, type NotesGraph } from "../graph/graph.ts"
import type { EdgeEntry, ParsedNode } from "../graph/types.ts"
import { matchQuery, parseQuery, extractArchiveReveal, extractScope, queryTargetsFolders, openLinkAt, DAILY_NOTE, type ScopeTarget, type QueryExpr } from "./query.ts"
import { INVALID_NAME_RE } from "../edit/attachments.ts"
import { partitionArchived } from "./archive.ts"
import { fileParent } from "./timeline.ts"

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
  /** Vault path of today's daily note: the target of `outline:":daily"`. Unset, `outline:":daily"` matches nothing. */
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
// outline edge is a "parent" edge recorded in that file, minus inline parent
// edges (`EdgeAttributes.inline`), which make the line a child of the note it
// links rather than of its outline parent.
//
// `[[note]]` keeps it inside the note's full subtree: every edge the search
// would follow anyway, recorded in any file, so children written elsewhere
// under a `[[note]]` link count too. `[[note#heading]]` roots it at that
// heading instead. Several scopes intersect.

type Scope = { keys: Set<string>; follow: EdgeFilter }

type NoteCandidate = { key: string; name: string; path: string; lowerPath: string; ageDays: number; isReference: boolean }

/** The notes `outline:`/`[[note]]` targets name, compared lowercase:
 *  - `outline:":daily"`: today's daily note (`SearchOptions.dailyNote`), by path;
 *  - exact (quoted, or a link): every note whose name or vault path (with or without `.md`) equals it;
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
  const follow: EdgeFilter = edge =>
    edge.attributes.type === "parent" && paths.has(edge.attributes.location.path) && !edge.attributes.inline
  const roots = graph
    .filterNodes((_, attrs) => attrs.nodeType === "page" && !attrs.isReference && paths.has(attrs.location.path))
  return { keys: reachable(graph, roots, follow), follow }
}

function treeScope(graph: NotesGraph, targets: ScopeTarget[], options: SearchOptions, follow: EdgeFilter): Scope {
  // An exact `note#heading` target is a heading key (getKey); an unknown one matches nothing, as an unknown note does.
  const isHeading = (t: ScopeTarget) => t.exact && t.value.includes("#")
  const headings = targets.filter(isHeading).map(t => t.value).filter(k => graph.hasNode(k))
  const roots = [...pickNotes(graph, targets.filter(t => !isHeading(t)), options, true).map(n => n.key), ...headings]
  return { keys: reachable(graph, roots, follow), follow }
}

// ── Filter helpers ────────────────────────────────────────────────────────────

function filterTreeByWord(node: ResultNode, expr: QueryExpr): ResultNode | null {
  if (matchQuery(node.node, expr)) return node  // matched: keep entire subtree

  const matchingChildren = node.children
    .map(child => filterTreeByWord(child, expr))
    .filter((c): c is ResultNode => c !== null)

  if (matchingChildren.length === 0) return null

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

// ── Exclusions ────────────────────────────────────────────────────────────────
//
// A negated term at the top level of a stage (`-x`, the `-x` of `a -x`) is an
// exclusion: a node matching any exclusion, from any stage, is left out of the
// result tree with everything under it. A negation inside an OR (`a | -b`)
// stays an ordinary term of its stage.

type Excluded = ((node: ParsedNode) => boolean) | null

/** Each stage's positive terms (`empty` when it has none), and the predicate for every stage's exclusions (null when none). */
function splitStages(stages: QueryExpr[]): { include: QueryExpr[]; excluded: Excluded } {
  const exclude: QueryExpr[] = []
  const include = stages.map((stage): QueryExpr => {
    const kept: QueryExpr[] = []
    for (const term of stage.type === "and" ? stage.exprs : [stage]) {
      if (term.type === "not") exclude.push(term.expr)
      else kept.push(term)
    }
    if (kept.length === 0) return { type: "empty" }
    return kept.length === 1 ? kept[0] : { type: "and", exprs: kept }
  })
  return { include, excluded: exclude.length === 0 ? null : node => exclude.some(x => matchQuery(node, x)) }
}

/** `follow` minus edges into excluded nodes, so a built tree never holds an excluded subtree. */
function skipExcluded(graph: NotesGraph, follow: EdgeFilter, excluded: Excluded): EdgeFilter {
  return excluded ? edge => follow(edge) && !excluded(graph.getNodeAttributes(edge.target)) : follow
}

/** Narrows `results` by each stage's positive terms in turn; a stage without any (only exclusions) keeps them all. */
function filterDown(results: ResultNode[], include: QueryExpr[]): ResultNode[] {
  let filtered = results
  for (const expr of include) {
    if (expr.type === "empty") continue
    filtered = filtered
      .map(r => filterTreeByWord(r, expr))
      .filter((r): r is ResultNode => r !== null)
  }
  return filtered
}

/** Text lines above `node` in its own note, nearest first: fileParent while the line is `nested` and the parent is
 *  text. Empty when `node` is not nested or no text parent is found; the last one is its block root. */
function blockAncestors(graph: NotesGraph, node: ParsedNode): ParsedNode[] {
  const above: ParsedNode[] = []
  let cur = node
  for (let guard = 0; guard < 64 && cur.nodeType === "text" && cur.nested; guard++) {
    const p = fileParent(graph, cur)
    if (!p || p.nodeType !== "text") break
    above.push(p)
    cur = p
  }
  return above
}

/** Nested lines are shown inside their outline block: a nested text result whose tree parent is not a text line
 *  (a result root, or a child reached through a link) is replaced by its block root built with its whole subtree,
 *  or dropped when a line between them is excluded. Siblings with the same key are kept once. */
function liftToBlocks(
  graph: NotesGraph,
  nodes: ResultNode[],
  follow: EdgeFilter,
  excluded: Excluded,
  parentIsText = false,
): ResultNode[] {
  const out: ResultNode[] = []
  const seen = new Set<string>()
  for (const r of nodes) {
    const above = !parentIsText && r.node.nodeType === "text" && r.node.nested ? blockAncestors(graph, r.node) : []
    if (excluded && above.some(excluded)) continue
    const next = above.length > 0
      ? buildTree(getKey(above[above.length - 1]), graph, new Map(), new Set(), follow)
      : { ...r, children: liftToBlocks(graph, r.children, follow, excluded, r.node.nodeType === "text") }
    const key = getKey(next.node)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(next)
  }
  return out
}

// ── Public API ────────────────────────────────────────────────────────────────

export function searchIndex(
  graph: NotesGraph,
  qs: string,
  separator: string,
  options: SearchOptions = {},
): ResultNode[] {
  // An open `[[fragment` turns the whole query into a link-target list; the fragment holds no `[[`, so this can't recurse.
  const open = openLinkAt(qs)
  if (open) return linkTargetTree(graph, open.fragment, separator)
  if (qs.length < 3) return []

  // Strip `is:archived` out of the matching stages (it is a visibility toggle,
  // not a matcher) so it never filters results; a bare `is:archived` stage is
  // substituted with the archived predicate so it still selects archived nodes.
  // `outline:`/`[[note]]` likewise leave the stages: they scope the candidates and edges.
  const { outline, tree, stages: expressions } =
    extractScope(extractArchiveReveal(parseQuery(qs, separator)).stages)
  const { include, excluded } = splitStages(expressions)
  const baseFollow: EdgeFilter = queryTargetsFolders(expressions) ? () => true : skipFolderEdges
  const scopes: Scope[] = [
    ...(outline.length > 0 ? [outlineScope(graph, outline, options)] : []),
    ...(tree.length > 0 ? [treeScope(graph, tree, options, baseFollow)] : []),
  ]
  const scoped: EdgeFilter = scopes.length === 0 ? baseFollow : edge => scopes.every(s => s.follow(edge))
  const follow = skipExcluded(graph, scoped, excluded)

  const roots = new Map<string, ResultNode>()
  const firstPass = include[0]

  const firstPageCandidates = graph
    .filterNodes((key, attrs) =>
      attrs.nodeType !== "pointer" && !excluded?.(attrs) && scopes.every(s => s.keys.has(key)) && matchQuery(attrs, firstPass))
    .sort((a, b) => b.length - a.length)

  const traversed = new Set<string>()

  for (const nodeKey of firstPageCandidates) {
    if (roots.has(nodeKey) || traversed.has(nodeKey)) continue
    const newNode = buildTree(nodeKey, graph, roots, traversed, follow)
    roots.set(nodeKey, newNode)
  }

  return liftToBlocks(graph, filterDown(Array.from(roots.values()), include.slice(1)), follow, excluded).sort(
    (a, b) => b.children.length - a.children.length,
  )
}

/**
 * Link targets for Insert Link and the editor's autocomplete: only page and
 * header nodes whose own key matches every query term (ANDed across stages,
 * regardless of hierarchy boundaries), with archived rows hidden. A `note#heading`
 * query lists headers instead: the note name contains every word before the first
 * `#`, and the heading every word after it (`not#hea` → `Note#Header1`, `Noting#Heading`).
 */
export function linkTargetTree(graph: NotesGraph, query: string, separator: string): ResultNode[] {
  const hash = query.indexOf("#")
  if (hash !== -1) {
    const words = (s: string) => s.toLowerCase().split(/\s+/).filter(w => w !== "")
    const noteWords = words(query.slice(0, hash))
    const headingWords = words(query.slice(hash + 1))
    const pruned = pruneResultTree(
      searchIndex(graph, [...noteWords, ...headingWords].join(" "), separator),
      n => n.nodeType === "header" &&
        noteWords.every(w => n.page.toLowerCase().includes(w)) &&
        headingWords.every(w => n.header.toLowerCase().includes(w)),
    )
    return partitionArchived(pruned, false).visible
  }
  const expr: QueryExpr = { type: "and", exprs: parseQuery(query, separator) }
  const pruned = pruneResultTree(
    searchIndex(graph, query, separator),
    n => (n.nodeType === "page" || n.nodeType === "header") && matchQuery(n, expr),
  )
  return partitionArchived(pruned, false).visible
}

/**
 * The name an open `[[query` would link as a new note: the trimmed query, or null when it is blank,
 * contains `#`, `^`, `[` or `]` or a character INVALID_NAME_RE rejects, names a page in `graph`
 * (note file or reference), or equals an alias of a page in `targets` (case-insensitive).
 */
export function newLinkName(graph: NotesGraph, query: string, targets: ResultNode[]): string | null {
  const name = query.trim()
  if (!name || /[#^[\]]/.test(name) || INVALID_NAME_RE.test(name)) return null
  const lower = name.toLowerCase()
  if (graph.hasNode(`[[${lower}]]`)) return null
  const aliased = (ns: ResultNode[]): boolean => ns.some(n =>
    (n.node.nodeType === "page" && n.node.aliases.some(a => a.toLowerCase() === lower)) || aliased(n.children))
  return aliased(targets) ? null : name
}

export function advancedSearch(
  graph: NotesGraph,
  exactRef: string,
  query: string,
  separator: string,
): ResultNode[] {
  const nodeKey = exactRef.toLowerCase()
  if (!graph.hasNode(nodeKey)) return []

  if (!query) return buildTree(nodeKey, graph, new Map(), new Set()).children

  // Strip `is:archived` from matching (it is a visibility toggle handled by
  // partitionArchived, not a matcher).
  const { include, excluded } = splitStages(extractArchiveReveal(parseQuery(query, separator)).stages)
  const tree = buildTree(nodeKey, graph, new Map(), new Set(), skipExcluded(graph, skipFolderEdges, excluded))

  return filterDown(tree.children, include)
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
