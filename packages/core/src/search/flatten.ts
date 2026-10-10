import type { ParsedNode } from "../graph/types.ts"
import type { ResultNode } from "./search.ts"
import { nodeMatchesQuery, type QueryExpr } from "./query.ts"
import { boostTier } from "../graph/boost.ts"
import { compareOpenTasks } from "./task-order.ts"

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

  // Siblings by boost (type tier, then emoji and recency), except that within a tier open tasks come first, oldest first.
  const order = (a: ResultNode, b: ResultNode): number =>
    boostTier(b.node.boost ?? 0) - boostTier(a.node.boost ?? 0) ||
    compareOpenTasks(a.node, a.node.ageDays, b.node, b.node.ageDays) ||
    (b.node.boost ?? 0) - (a.node.boost ?? 0)

  function flatten(unsorted: ResultNode[], indent = 0, parentIndex = 0): number {
    const nodes = [...unsorted].sort(order)
    let index = parentIndex

    for (const node of nodes) {
      result.push({
        node: node.node,
        indent,
        hasChildren: node.children.length > 0,
        visible: false,
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
  defaultVisibility(result, defaultIndentLevel).forEach((v, i) => { result[i].visible = v })
  return result
}

// Default `visible` per row of a pre-order flattened tree: rows deeper than
// `level` are hidden, and so is everything under a greyed-out subtree, i.e. a
// dimmed (`!matched`) or archived row whose descendants are all greyed out too.
// That root row itself stays visible, so a click on its bullet expands it.
export function defaultVisibility(rows: readonly { indent: number; matched: boolean; archived?: boolean }[], level: number): boolean[] {
  const grey = (r: { matched: boolean; archived?: boolean }) => !r.matched || r.archived === true
  // Backward pass: anyBright[d] = some row at depth d since the last row at a
  // shallower depth has a bright row in its subtree. For row i at depth k,
  // anyBright[k + 1] therefore covers exactly i's children.
  const fullyGrey = new Array<boolean>(rows.length)
  const anyBright: boolean[] = []
  for (let i = rows.length - 1; i >= 0; i--) {
    const k = rows[i].indent
    const bright = !grey(rows[i]) || anyBright[k + 1] === true
    fullyGrey[i] = !bright
    anyBright.length = k + 1
    anyBright[k] = anyBright[k] === true || bright
  }

  const visible = new Array<boolean>(rows.length)
  let collapsedBelow = Infinity  // indent of the open greyed-out root, if any
  for (let i = 0; i < rows.length; i++) {
    const k = rows[i].indent
    if (k <= collapsedBelow) collapsedBelow = Infinity
    visible[i] = k <= level && k <= collapsedBelow
    if (fullyGrey[i] && collapsedBelow === Infinity) collapsedBelow = k
  }
  return visible
}
