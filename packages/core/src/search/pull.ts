import type { NotesGraph } from "../graph/graph.ts"
import type { EdgeEntry, Location, ParsedNode } from "../graph/types.ts"
import { isUndated } from "../graph/boost.ts"
import { reverseMarkdownParsing } from "./copy.ts"

const DEFAULT_MAX_DEPTH = 5
const MS_PER_DAY = 24 * 60 * 60 * 1000

// ── Tree ──────────────────────────────────────────────────────────────────────

export type PullNode = {
  key: string
  node: ParsedNode
  children: PullNode[]
}

/**
 * Depth-limited, node-deduplicated subtree rooted at `rootKey`, for the
 * "Pull children" action. Mirrors `buildTree`'s edge walk (folder edges
 * excluded, same as ordinary browsing) but bounded so the action never
 * materializes an unbounded graph, and deduplicated by node key so a node
 * reachable via more than one path is included once, at its
 * first-encountered position - the pulled block should never show the same
 * target twice.
 *
 * A real (non-reference) page's own headers and directly-authored text
 * bullets are its existing document body, not a scattered mention of it -
 * pulling "from Parent" should surface the topics nested under it
 * ([[Child]] in [[Parent]], recursively) and mentions of it captured
 * elsewhere, not Parent's own note content back into itself. Those own-body
 * header/text nodes are therefore walked through transparently (so a
 * [[Page]] nested under a heading is still reached) but never materialized
 * as a pull candidate. This check re-resets at every page node: a virtual/
 * reference page has no file of its own to hide, and descending into a
 * different real page (e.g. [[Child]] itself has its own note) applies the
 * same rule against *that* page's file.
 */
export function buildPullTree(graph: NotesGraph, rootKey: string, maxDepth = DEFAULT_MAX_DEPTH): PullNode | null {
  if (!graph.hasNode(rootKey)) return null

  const seen = new Set<string>([rootKey])

  function collectChildren(key: string, ownPath: string | null, depth: number, out: PullNode[]): void {
    for (const edge of graph.outboundEdgeEntries(key)) {
      if (edge.attributes.type === "folder") continue
      if (seen.has(edge.target)) continue
      const childNode = { ...graph.getNodeAttributes(edge.target), location: edge.attributes.location }

      seen.add(edge.target)

      if (isOwnBodyEdge(graph, ownPath, edge)) {
        // Own-body descendants are walked through transparently using the
        // *same* ownPath - a header/text node has no real file of its own,
        // so re-deriving ownPath from it (rather than threading the
        // enclosing page's) would lose the exclusion for anything nested
        // one level deeper (e.g. a text bullet under a header).
        collectChildren(edge.target, ownPath, depth, out)
      } else {
        out.push(walk(edge.target, childNode, depth + 1))
      }
    }
  }

  function walk(key: string, node: ParsedNode, depth: number): PullNode {
    const children: PullNode[] = []
    if (depth < maxDepth) {
      collectChildren(key, ownBodyPath(graph, key), depth, children)
    }
    return { key, node, children }
  }

  return walk(rootKey, graph.getNodeAttributes(rootKey), 0)
}

/**
 * `key`'s own real file path if it's a real (non-reference) page, otherwise
 * `null`. Looks up the *canonical* stored node for `key`, not an
 * edge-adjusted copy carrying the location of a specific occurrence - a
 * page's own file is a property of the page itself, independent of which
 * edge led here.
 */
function ownBodyPath(graph: NotesGraph, key: string): string | null {
  const attrs = graph.getNodeAttributes(key)
  return attrs.nodeType === "page" && !attrs.isReference ? attrs.location.path : null
}

/**
 * Whether `edge` represents a step into the enclosing real page's own
 * document body (a header/text node physically living at `ownPath`) rather
 * than a foreign mention/topic captured elsewhere. `ownPath` is that page's
 * own file path (`ownBodyPath` above) - `null` means there is no real file
 * to be "own body" of, so nothing qualifies. `buildPullTree` descends
 * through such edges transparently rather than materializing them as pull
 * candidates.
 */
function isOwnBodyEdge(graph: NotesGraph, ownPath: string | null, edge: EdgeEntry): boolean {
  if (ownPath === null) return false
  const targetAttrs = graph.getNodeAttributes(edge.target)
  return (targetAttrs.nodeType === "header" || targetAttrs.nodeType === "text")
    && edge.attributes.location.path === ownPath
}

/**
 * Whether `node`'s link to its pull-tree parent is declared in the node's
 * own frontmatter (`parent: "[[Root]]"`) rather than written as a bullet
 * somewhere. The indexer records that edge at the page's own location -
 * line 0 of its file, the opening `---` delimiter - so there is no source
 * line to delete and nothing to relocate: the hierarchy is already declared
 * in the child's own note. A real page is otherwise never located inside
 * its own file, so the path comparison identifies exactly these edges.
 */
export function isFrontmatterRelation(graph: NotesGraph, node: PullNode): boolean {
  return ownBodyPath(graph, node.key) === node.node.location.path
}

// ── Date reconstruction ──────────────────────────────────────────────────────

/**
 * Reconstructs the calendar date a line was recorded on, for the provenance
 * stamp appended to pulled lines. Only meaningful for "text" nodes (an actual
 * authored capture line) - structural page/header reference nodes (e.g. the
 * `[[Child]]` aggregation bullet itself) never get a date, since they are the
 * topic being aggregated, not a recorded occurrence. No absolute timestamp is
 * stored anywhere in the graph, only the relative `ageDays`; since `ageDays`
 * is itself derived from an exact source (an embedded YYYY-MM-DD or the
 * periodic-note resolver), `today - ageDays` reconstructs it losslessly.
 */
export function formatOccurrenceDate(node: ParsedNode): string | null {
  if (node.nodeType !== "text") return null
  if (isUndated(node.ageDays)) return null
  const ms = Date.now() - node.ageDays * MS_PER_DAY
  return new Date(ms).toISOString().slice(0, 10)
}

// ── Write plan ────────────────────────────────────────────────────────────────

export type PullLine = { depth: number; text: string }

/** A topic's resolved destination note. `exists: false` means the caller
 * (which owns `app.vault`) still needs to create it before writing. */
export type OrganiseHome = { path: string; exists: boolean }

/** Everything to write into one home: its new direct-topic links (bare,
 * undated, always starting at depth 0 since a page-link always starts a
 * fresh anchor - though a link may be followed by further depth>0 lines,
 * see `extraLinesOf` below) and its new text mentions (verbatim line +
 * date, as before) - `depth` on a mention reflects its actual nesting under
 * its parent bullet, relative to whichever anchor/home it was routed to. */
export type SectionWrite = { home: OrganiseHome; children: PullLine[]; mentions: PullLine[] }

/** Renders one `PullLine` as an indented markdown bullet, 4 spaces per depth
 * level. Obsidian's own list renderer (unlike this plugin's own lenient
 * list-scanner, which accepts any consistent indent step when building
 * graph edges) only recognises a bullet as a *nested* list item once it's
 * indented a full tab-stop (4 spaces) past its parent - a 2-space step
 * renders as literal paragraph text (dash and all) instead of a sub-bullet. */
export function renderPullLine(line: PullLine): string {
  return `${"    ".repeat(line.depth)}- ${line.text}`
}

/**
 * Plans where every checked node in `root` ends up, organised by topic
 * rather than flattened into wherever the pull was started. `root`'s own
 * checked children go to `rootHome` (the note you're organising from -
 * always exists, never auto-created). From there, every checked **page**
 * child is (a) added as a bare link line to the *current* anchor's
 * `children` list, and (b) recursed into using *its own* resolved home
 * (`resolveHome(child.key)`) as the new anchor for its descendants - this is
 * what routes a topic's own detail lines into its own note even when the
 * pull started somewhere else. Every checked **text** child (a mention) is
 * added to the current anchor's `mentions` list and recursed into using the
 * *same* anchor (a mention's own sub-lines, if any, still belong to whatever
 * topic the mention itself belongs to).
 *
 * `resolveHome` is only ever called for a page-child that has at least one
 * checked child of its own - a checked leaf topic with nothing beneath it
 * never gets a home computed (and so never causes a new file to be created)
 * for content it wouldn't actually receive.
 */
export function planOrganiseWrites(
  graph: NotesGraph,
  root: PullNode,
  rootHome: OrganiseHome,
  isChecked: (key: string) => boolean,
  resolveHome: (pageKey: string) => OrganiseHome,
  // Verbatim, undated lines the indexer skipped entirely (plain text, no
  // link/tag/URL) but that were still nested under a given node in the
  // source file - carried along so organising doesn't silently drop detail
  // the graph never knew about. Called for both branches below: once for a
  // mention's own sub-lines (relative to the mention's current depth), and
  // once for a bare-link page-child's own sub-lines (relative to 0, since
  // the link itself always renders at depth 0).
  extraLinesOf: (node: PullNode, depth: number) => PullLine[] = () => [],
): SectionWrite[] {
  const byHomePath = new Map<string, SectionWrite>()

  function ensureWrite(home: OrganiseHome): SectionWrite {
    const existing = byHomePath.get(home.path)
    if (existing) return existing
    const created: SectionWrite = { home, children: [], mentions: [] }
    byHomePath.set(home.path, created)
    return created
  }

  // Selection is per row: an unchecked node writes nothing itself, but its
  // descendants are still visited so a checked line beneath an unchecked
  // topic (the pane leaves sub-topic rows unchecked by default) is filed.
  function visit(node: PullNode, homeThunk: () => OrganiseHome, depth: number): void {
    for (const child of node.children) {
      const checked = isChecked(child.key)

      if (child.node.nodeType === "page") {
        // A frontmatter-declared child already records its parent; only its
        // own descendants (routed into its own home below) need filing.
        if (checked && !isFrontmatterRelation(graph, child)) {
          const write = ensureWrite(homeThunk())
          write.children.push({ depth: 0, text: reverseMarkdownParsing(child.node) })
          for (const extra of extraLinesOf(child, 0)) write.children.push(extra)
        }
        let childHome: OrganiseHome | null = null
        visit(child, () => childHome ?? (childHome = resolveHome(child.key)), 0)
      } else if (checked) {
        const write = ensureWrite(homeThunk())
        const date = formatOccurrenceDate(child.node)
        // Only the mention's own line gets a date; extra lines never do,
        // since they were never a node the graph could date independently.
        write.mentions.push({ depth, text: reverseMarkdownParsing(child.node) + (date ? ` ${date}` : "") })
        for (const extra of extraLinesOf(child, depth)) write.mentions.push(extra)

        visit(child, homeThunk, depth + 1)
      } else {
        // The mention's own line stays behind, so its checked sub-lines take
        // its place in the nesting rather than hanging one level too deep.
        visit(child, homeThunk, depth)
      }
    }
  }

  visit(root, () => rootHome, 0)
  return Array.from(byHomePath.values())
}

// ── Deletion plan ─────────────────────────────────────────────────────────────

export type PullDeletion = { key: string; location: Location }

const lineKey = (location: Location): string => `${location.path}:${location.position.start.line}`

/**
 * Source lines to delete after a pull is applied. `root` itself is never a
 * candidate - only checked descendants are ever removed from their source,
 * and never a frontmatter-declared relation (its "line" is the `---`
 * delimiter). Unchecked nodes are never deleted, but their descendants are
 * still considered, mirroring `planOrganiseWrites`.
 *
 * A candidate line is only deleted if every line that can be physically
 * nested under it is deleted too - otherwise the survivors would be
 * silently re-parented under whatever bullet precedes them. Those are the
 * line's graph children recorded in the *same file, below it*; each must
 * itself be a surviving candidate *at that exact location*. Location, not
 * node key, is what matters: a key deduplicated to a different position in
 * the pull tree (e.g. placed at its frontmatter relation) is not deleted
 * here, so it can't vouch for this occurrence. A child the depth cap never
 * surfaced is never a candidate, so it blocks too. Children recorded in
 * other files - mentions elsewhere, a page's own body, a child's frontmatter
 * relation - are not nested under this line and are unaffected by removing
 * it. The pruning repeats until stable, since dropping one candidate can
 * block its parent. Conservative in one direction only: a later same-file
 * line from another occurrence of the same key is treated as nested.
 */
export function planDeletions(graph: NotesGraph, root: PullNode, isChecked: (key: string) => boolean): PullDeletion[] {
  const candidates = new Map<string, { node: PullNode; nested: string[] }>()
  ;(function collect(node: PullNode): void {
    for (const child of node.children) {
      if (isChecked(child.key) && !isFrontmatterRelation(graph, child)) {
        const at = child.node.location
        const nested = graph
          .outboundEdgeEntries(child.key)
          .filter(e => e.attributes.type !== "folder"
            && e.attributes.location.path === at.path
            && e.attributes.location.position.start.line > at.position.start.line)
          .map(e => lineKey(e.attributes.location))
        candidates.set(lineKey(at), { node: child, nested })
      }
      collect(child)
    }
  })(root)

  let changed = true
  while (changed) {
    changed = false
    for (const [key, candidate] of candidates) {
      if (candidate.nested.some(k => !candidates.has(k))) {
        candidates.delete(key)
        changed = true
      }
    }
  }

  return Array.from(candidates.values(), ({ node }) => ({ key: node.key, location: node.node.location }))
}
