import type { ParsedNode } from "../graph/types.ts"
import type { ResultNode } from "./search.ts"
import { getKey, type NotesGraph } from "../graph/graph.ts"
import { containsEmoji, isUndated, UNDATED_AGE } from "../graph/boost.ts"
import { matchQuery, nodeMatchesQuery, type QueryExpr } from "./query.ts"

export type TimelineItem = {
  node: ParsedNode
  breadcrumb: ParsedNode[]   // matched ancestors, root-first
  pinned: boolean            // emoji-boosted (containsEmoji(searchKey))
  archived: boolean          // ResultNode.effectiveArchived ?? false
  ageDays: number            // node.ageDays, or the fallback's age when undated
}

// Flat, date-ordered projection of a search result tree. Items are the nodes
// that themselves match the last query stage — the rows the tree highlights
// for that stage. Context the tree keeps but dims (a hit's non-matching
// subtree, ancestors kept only for earlier stages) is not an item; matched
// ancestors become the breadcrumb. Emoji-bearing nodes are pinned
// and, mirroring `in:`, bypass the recency window. `fallbackAgeDays` dates
// undated nodes (the host supplies e.g. the containing file's ctime; core stays
// filesystem-agnostic); nodes it cannot date are dropped unless pinned.
export function buildTimeline(
  results: ResultNode[],
  stages: QueryExpr[],
  windowDays: number | null = null,
  fallbackAgeDays?: (node: ParsedNode) => number | null,
): TimelineItem[] {
  const target = stages[stages.length - 1]
  const items = new Map<string, TimelineItem>()
  const ancestors: ParsedNode[] = []

  const visit = (r: ResultNode): void => {
    const node = r.node
    const hit = target === undefined || matchQuery(node, target)
    if (hit && node.nodeType !== "pointer") {
      const pinned = containsEmoji(node.searchKey)
      const ageDays = isUndated(node.ageDays) ? (fallbackAgeDays?.(node) ?? UNDATED_AGE) : node.ageDays
      if (pinned || (!isUndated(ageDays) && (windowDays === null || ageDays <= windowDays))) {
        const breadcrumb = ancestors.filter(a => a.nodeType !== "pointer" && nodeMatchesQuery(a, stages))
        const key = getKey(node)
        const existing = items.get(key)
        if (existing === undefined) {
          items.set(key, { node, breadcrumb, pinned, archived: r.effectiveArchived ?? false, ageDays })
        } else if (breadcrumb.length > existing.breadcrumb.length) {
          existing.node = node
          existing.breadcrumb = breadcrumb
          existing.archived = r.effectiveArchived ?? false
          existing.ageDays = ageDays
        }
      }
    }
    if (r.children.length === 0) return
    ancestors.push(node)
    for (const child of r.children) visit(child)
    ancestors.pop()
  }

  for (const r of results) visit(r)

  return [...items.values()].sort((a, b) =>
    (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1) ||
    a.ageDays - b.ageDays ||
    b.node.boost - a.node.boost,
  )
}

// Structural parent of a text line or header inside its own note: the
// enclosing header, the parent bullet, or the note itself. Search results
// start at the matched node, so this is the context shown when no matched
// ancestor exists. Lines also get "parent" edges (same location) from every
// page/header they link to; those refs are skipped.
export function fileParent(graph: NotesGraph, node: ParsedNode): ParsedNode | null {
  if (node.nodeType !== "text" && node.nodeType !== "header") return null
  const refs = node.nodeType === "text"
    ? new Set(graph.getObsidianLinkReferences(node.parsedTokens).map(r =>
        (r.headerName ? `${r.pageTarget}#${r.headerName}` : `[[${r.pageTarget.replace(/\.canvas$/i, "")}]]`).toLowerCase()))
    : undefined
  for (const e of graph.inboundEdgeEntries(getKey(node))) {
    if (e.attributes.type !== "parent" || e.attributes.location.path !== node.location.path) continue
    if (refs?.has(e.source)) continue
    const parent = graph.getNodeAttributes(e.source)
    if (parent.nodeType !== "pointer") return parent
  }
  return null
}
