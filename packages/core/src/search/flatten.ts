import type { ParsedNode } from "../graph/types.ts"
import type { ResultNode } from "./search.ts"
import { nodeMatchesQuery, type QueryExpr } from "./query.ts"

export type TreeNode = {
  node: ParsedNode
  indent: number
  hasChildren: boolean
  visible: boolean
  selected: boolean
  index: number
  matched: boolean
  // True when this row is archived or sits under an archived ancestor (only
  // populated when archived items are revealed via `is:archived`). Rendered
  // greyed, independently of `matched`.
  archived: boolean
}

export function flattenIndex(
  indexed: ResultNode[],
  defaultIndentLevel = 0,
  matchExprs: QueryExpr[] = [],
): TreeNode[] {
  const result: TreeNode[] = []

  function flatten(unsorted: ResultNode[], indent = 0, parentIndex = 0): number {
    const nodes = [...unsorted].sort((a, b) => (b.node.boost ?? 0) - (a.node.boost ?? 0))
    let index = parentIndex

    for (const node of nodes) {
      result.push({
        node: node.node,
        indent,
        hasChildren: node.children.length > 0,
        visible: indent <= defaultIndentLevel,
        selected: false,
        index,
        matched: nodeMatchesQuery(node.node, matchExprs),
        archived: node.effectiveArchived ?? false,
      })
      index += 1
      index = flatten(node.children, indent + 1, index)
    }
    return index
  }

  flatten(indexed)
  return result
}
