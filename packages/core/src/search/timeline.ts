import type { ParsedNode } from "../graph/types.ts"
import type { ResultNode } from "./search.ts"
import { getKey } from "../graph/graph.ts"
import { containsEmoji, isUndated, UNDATED_AGE } from "../graph/boost.ts"
import { matchQuery, nodeMatchesQuery, type QueryExpr } from "./query.ts"

export type TimelineItem = {
  node: ParsedNode
  breadcrumb: ParsedNode[]   // matched ancestors, root-first
  pinned: boolean            // emoji-boosted (containsEmoji(searchKey))
  archived: boolean          // ResultNode.effectiveArchived ?? false
  ageDays: number            // node.ageDays, or the fallback's age when undated
}

// Flat, date-ordered projection of a search result tree. Items are nodes
// matching the last query stage plus everything below them — the same set the
// tree shows for that stage, since `filterDown` keeps a matched node's whole
// subtree. Ancestors kept only for earlier stages are not items (tree
// membership alone does not imply a match). Emoji-bearing nodes are pinned
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

  const visit = (r: ResultNode, underHit: boolean): void => {
    const node = r.node
    const hit = underHit || target === undefined || matchQuery(node, target)
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
    for (const child of r.children) visit(child, hit)
    ancestors.pop()
  }

  for (const r of results) visit(r, false)

  return [...items.values()].sort((a, b) =>
    (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1) ||
    a.ageDays - b.ageDays ||
    b.node.boost - a.node.boost,
  )
}
