import type { NotesGraph } from "../graph/graph.ts"
import type { Location, ParsedNode } from "../graph/types.ts"
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

  // Looks up the *canonical* stored node for `key`, not the edge-adjusted
  // copy `walk` renders (which carries the location of the specific
  // occurrence/edge it was reached through) - a page's own file is a
  // property of the page itself, independent of which edge led here.
  function ownBodyPath(key: string): string | null {
    const attrs = graph.getNodeAttributes(key)
    return attrs.nodeType === "page" && !attrs.isReference ? attrs.location.path : null
  }

  function collectChildren(key: string, ownPath: string | null, depth: number, out: PullNode[]): void {
    for (const edge of graph.outboundEdgeEntries(key)) {
      if (edge.attributes.type === "folder") continue
      if (seen.has(edge.target)) continue
      const childNode = { ...graph.getNodeAttributes(edge.target), location: edge.attributes.location }

      const isOwnBody = ownPath !== null
        && (childNode.nodeType === "header" || childNode.nodeType === "text")
        && edge.attributes.location.path === ownPath

      seen.add(edge.target)

      if (isOwnBody) {
        collectChildren(edge.target, ownPath, depth, out)
      } else {
        out.push(walk(edge.target, childNode, depth + 1))
      }
    }
  }

  function walk(key: string, node: ParsedNode, depth: number): PullNode {
    const children: PullNode[] = []
    if (depth < maxDepth) {
      collectChildren(key, ownBodyPath(key), depth, children)
    }
    return { key, node, children }
  }

  return walk(rootKey, graph.getNodeAttributes(rootKey), 0)
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
 * undated - `depth` is always 0, kept only so `PullLine` stays one shared
 * shape) and its new text mentions (verbatim line + date, as before). */
export type SectionWrite = { home: OrganiseHome; children: PullLine[]; mentions: PullLine[] }

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
  root: PullNode,
  rootHome: OrganiseHome,
  isChecked: (key: string) => boolean,
  resolveHome: (pageKey: string) => OrganiseHome,
): SectionWrite[] {
  const byHomePath = new Map<string, SectionWrite>()

  function ensureWrite(home: OrganiseHome): SectionWrite {
    const existing = byHomePath.get(home.path)
    if (existing) return existing
    const created: SectionWrite = { home, children: [], mentions: [] }
    byHomePath.set(home.path, created)
    return created
  }

  function visit(node: PullNode, homeThunk: () => OrganiseHome): void {
    for (const child of node.children) {
      if (!isChecked(child.key)) continue

      if (child.node.nodeType === "page") {
        const write = ensureWrite(homeThunk())
        write.children.push({ depth: 0, text: reverseMarkdownParsing(child.node) })

        let childHome: OrganiseHome | null = null
        visit(child, () => childHome ?? (childHome = resolveHome(child.key)))
      } else {
        const write = ensureWrite(homeThunk())
        const date = formatOccurrenceDate(child.node)
        write.mentions.push({ depth: 0, text: reverseMarkdownParsing(child.node) + (date ? ` ${date}` : "") })

        visit(child, homeThunk)
      }
    }
  }

  visit(root, () => rootHome)
  return Array.from(byHomePath.values())
}

// ── Deletion plan ─────────────────────────────────────────────────────────────

export type PullDeletion = { key: string; location: Location }

/**
 * A source line is safe to delete only if every one of its (non-folder)
 * graph children is itself checked somewhere in this pull - `checkedKeys` is
 * gathered across the *whole* tree (not just this node's immediate pulled
 * children), so a node deduplicated away from this position (because it was
 * already placed elsewhere in the subtree) still counts as accounted for.
 * A child that exists in the graph but was never surfaced at all - because
 * the depth-5 cap truncated it - is, by construction, never in `checkedKeys`,
 * so a line with a real, un-offered descendant is correctly never deleted.
 *
 * Note: for a node whose identity is shared across multiple physical
 * occurrences in the vault (a bare-wikilink reference, merged by content),
 * this check is global rather than per-occurrence - the graph does not
 * record which specific occurrence produced a given edge. In practice this
 * only makes the check *more* conservative (an unrelated occurrence
 * elsewhere in the vault can block a deletion that would otherwise be safe
 * for this specific line), never less - consistent with "don't be
 * aggressive".
 */
function isSafeToDeleteSource(graph: NotesGraph, key: string, checkedKeys: Set<string>): boolean {
  return graph
    .outboundEdgeEntries(key)
    .filter(e => e.attributes.type !== "folder")
    .every(e => checkedKeys.has(e.target))
}

/**
 * Source lines to delete after a pull is applied. `root` itself is never a
 * candidate - only pulled descendants are ever removed from their source.
 */
export function planDeletions(graph: NotesGraph, root: PullNode, isChecked: (key: string) => boolean): PullDeletion[] {
  const checkedKeys = new Set<string>()
  ;(function collect(node: PullNode): void {
    for (const child of node.children) {
      if (isChecked(child.key)) checkedKeys.add(child.key)
      collect(child)
    }
  })(root)

  const deletions: PullDeletion[] = []
  ;(function visit(node: PullNode): void {
    for (const child of node.children) {
      if (!isChecked(child.key)) continue
      if (isSafeToDeleteSource(graph, child.key, checkedKeys)) {
        deletions.push({ key: child.key, location: child.node.location })
      }
      visit(child)
    }
  })(root)

  return deletions
}
