import type { ParsedNode } from "../graph/types.ts"
import type { ResultNode } from "./search.ts"

export function isArchived(node: ParsedNode): boolean {
  if (node.nodeType !== "text") return false
  return node.parsedTokens.some(
    t => t.tokenType === "meta_mdtree" && t.directive === "archive",
  )
}

function subtreeSize(node: ResultNode): number {
  let count = 1
  for (const child of node.children) count += subtreeSize(child)
  return count
}

export function partitionArchived(
  results: ResultNode[],
): { visible: ResultNode[]; archivedCount: number } {
  let archivedCount = 0
  const visible: ResultNode[] = []
  for (const node of results) {
    if (isArchived(node.node)) {
      archivedCount += subtreeSize(node)
      continue
    }
    const filtered = partitionArchived(node.children)
    archivedCount += filtered.archivedCount
    visible.push(
      filtered.archivedCount > 0
        ? { ...node, children: filtered.visible }
        : node,
    )
  }
  return { visible, archivedCount }
}
