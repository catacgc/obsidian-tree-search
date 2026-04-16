import type { ParsedNode } from "../graph/types.ts"
import type { ResultNode } from "./search.ts"

export type TreeNode = {
  node: ParsedNode
  indent: number
  hasChildren: boolean
  visible: boolean
  selected: boolean
  index: number
}

export function flattenIndex(indexed: ResultNode[], defaultIndentLevel = 0): TreeNode[] {
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
      })
      index += 1
      index = flatten(node.children, indent + 1, index)
    }
    return index
  }

  flatten(indexed)
  return result
}
