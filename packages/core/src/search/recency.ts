import { isUndated } from "../graph/boost.ts"
import type { ResultNode } from "./search.ts"

// Tree-mode recency filter. Keeps every node dated within `windowDays`, the
// ancestors leading to it, and its undated immediate children as context.
// Everything else is pruned: a subtree with no in-window node disappears, and
// a dated node outside the window is dropped unless something below it is in
// the window. Undated nodes never satisfy the window themselves (see
// UNDATED_AGE). Returns new ResultNode objects; the input is not mutated.
export function pruneToRecency(results: ResultNode[], windowDays: number): ResultNode[] {
  // null = pruned; anchored = this node or a kept descendant is in the window.
  const visit = (r: ResultNode, parentInWindow: boolean): { node: ResultNode; anchored: boolean } | null => {
    const hit = !isUndated(r.node.ageDays) && r.node.ageDays <= windowDays
    const children: ResultNode[] = []
    let anchoredBelow = false
    for (const child of r.children) {
      const kept = visit(child, hit)
      if (kept === null) continue
      children.push(kept.node)
      anchoredBelow ||= kept.anchored
    }
    const anchored = hit || anchoredBelow
    if (!anchored && !(parentInWindow && isUndated(r.node.ageDays))) return null
    return { node: { ...r, children }, anchored }
  }

  const kept: ResultNode[] = []
  for (const r of results) {
    const v = visit(r, false)
    if (v !== null) kept.push(v.node)
  }
  return kept
}
