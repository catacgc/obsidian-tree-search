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

// ── Merge detection ──────────────────────────────────────────────────────────

/**
 * Does `key` already have a known occurrence in `destinationPath`? Checked
 * against the graph (already-indexed state), not a live scan of the
 * destination buffer - consistent with how the rest of the plugin treats the
 * graph as the source of truth. Covers both "the destination IS this node's
 * own canonical file" and "this node is referenced/nested somewhere in the
 * destination file".
 */
export function findExistingOccurrence(graph: NotesGraph, key: string, destinationPath: string): Location | null {
  if (!graph.hasNode(key)) return null
  const node = graph.getNodeAttributes(key)
  if (node.location.path === destinationPath) return node.location

  const inbound = graph.inboundEdgeEntries(key).find(e => e.attributes.location.path === destinationPath)
  return inbound ? inbound.attributes.location : null
}

// ── Write plan ────────────────────────────────────────────────────────────────

export type PullLine = { depth: number; text: string }

export type PullWriteAnchor = { type: "cursor" } | { type: "existing"; location: Location }

export type PullWrite = { anchor: PullWriteAnchor; lines: PullLine[] }

/**
 * Renders the checked nodes of `root` (never `root` itself - only its
 * descendants are ever materialized) into one or more writes. A checked node
 * with no existing occurrence in the destination renders fresh, inline, at
 * its parent's insertion point. A checked node that already occurs in the
 * destination is never duplicated there - only its own checked children (if
 * any) are rendered, as a separate write anchored to that existing
 * occurrence's location, so re-running a pull on a note that already
 * received part of this subtree appends rather than duplicates.
 */
export function planPullWrites(
  root: PullNode,
  isChecked: (key: string) => boolean,
  existingOccurrenceOf: (key: string) => Location | null,
): PullWrite[] {
  const writes: PullWrite[] = []

  function renderNode(node: PullNode, depth: number, out: PullLine[]): void {
    const date = formatOccurrenceDate(node.node)
    const text = reverseMarkdownParsing(node.node) + (date ? ` ${date}` : "")
    out.push({ depth, text })
    renderChildrenInto(node, depth + 1, out)
  }

  function renderChildrenInto(node: PullNode, depth: number, out: PullLine[]): void {
    for (const child of node.children) {
      if (!isChecked(child.key)) continue

      const existing = existingOccurrenceOf(child.key)
      if (existing) {
        const mergeLines: PullLine[] = []
        renderChildrenInto(child, 0, mergeLines)
        if (mergeLines.length > 0) {
          writes.push({ anchor: { type: "existing", location: existing }, lines: mergeLines })
        }
      } else {
        renderNode(child, depth, out)
      }
    }
  }

  const topLines: PullLine[] = []
  renderChildrenInto(root, 0, topLines)
  if (topLines.length > 0) writes.push({ anchor: { type: "cursor" }, lines: topLines })

  return writes
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
