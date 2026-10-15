import type { ParsedNode } from "../graph/types.ts"
import type { ResultNode } from "./search.ts"
import { isArchived } from "./query.ts"

// `isArchived` (the intrinsic per-node check) lives in query.ts so the query
// matcher can reference it without an import cycle; re-exported here to keep the
// historical import path (`search/archive.ts`) working.
export { isArchived }

/** The archive action a heading or line row offers: `unarchive` when it carries the archive tag itself, none when it
 *  is archived only through its note, heading or parent line (the tag lives there), else `archive`. */
export function archiveToggle(node: ParsedNode): "archive" | "unarchive" | null {
  if (!isArchived(node)) return "archive"
  return node.archiveInherited ? null : "unarchive"
}

function subtreeSize(node: ResultNode): number {
  let count = 1
  for (const child of node.children) count += subtreeSize(child)
  return count
}

// Partition a result forest by archive visibility, path-contextually: a node is
// *effectively archived* if it is intrinsically archived or any ancestor along
// its path in this result tree is. Computed here (over the final forest) rather
// than during tree construction so it is robust to build order and to any
// downstream promotion that reparents nodes.
//
// - reveal = false (default): drop every effectively-archived subtree and report
//   how many nodes were hidden (the caller shows an "Archive (N)" affordance).
// - reveal = true: keep everything, stamp `effectiveArchived` on each kept node
//   so the view can render archived rows greyed, and report a zero count.
export function partitionArchived(
  results: ResultNode[],
  reveal = false,
): { visible: ResultNode[]; archivedCount: number } {
  let archivedCount = 0
  const visible: ResultNode[] = []

  function walk(nodes: ResultNode[], ancestorArchived: boolean): ResultNode[] {
    const kept: ResultNode[] = []
    for (const node of nodes) {
      const effective = ancestorArchived || isArchived(node.node)
      if (effective && !reveal) {
        archivedCount += subtreeSize(node)
        continue
      }
      const children = walk(node.children, effective)
      kept.push({ ...node, effectiveArchived: effective, children })
    }
    return kept
  }

  visible.push(...walk(results, false))
  return { visible, archivedCount }
}
