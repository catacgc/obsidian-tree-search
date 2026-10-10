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
  // True when the row is hidden only because its list is compacted (a "+N more" footer reveals it).
  compacted: boolean
}

/** Lists with at least this many children show only a compact preview until expanded. */
export const BLOCK_COMPACT_MIN = 4

/** Children kept when compacting: all below BLOCK_COMPACT_MIN, else the first 3 plus every bright one. */
export function compactChildren(bright: readonly boolean[]): boolean[] {
  return bright.length < BLOCK_COMPACT_MIN ? bright.map(() => true) : bright.map((b, i) => i < BLOCK_COMPACT_MIN - 1 || b)
}

/** Sibling order of result rows: by boost (type tier, then emoji and recency), except that within a tier open tasks
 *  come first, oldest first. */
export function compareSiblings(a: ResultNode, b: ResultNode): number {
  return (
    boostTier(b.node.boost ?? 0) - boostTier(a.node.boost ?? 0) ||
    compareOpenTasks(a.node, a.node.ageDays, b.node, b.node.ageDays) ||
    (b.node.boost ?? 0) - (a.node.boost ?? 0)
  )
}

export function flattenIndex(
  indexed: ResultNode[],
  defaultIndentLevel = 0,
  matchExprs: QueryExpr[] = [],
): TreeNode[] {
  const result: TreeNode[] = []

  function flatten(unsorted: ResultNode[], indent = 0, parentIndex = 0): number {
    const nodes = [...unsorted].sort(compareSiblings)
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
        compacted: false,
      })
      index += 1
      index = flatten(node.children, indent + 1, index)
    }
    return index
  }

  flatten(indexed)
  defaultVisibility(result, defaultIndentLevel).forEach((v, i) => {
    result[i].visible = v.visible
    result[i].compacted = v.compacted
  })
  return result
}

export type RowVisibility = { visible: boolean; compacted: boolean }

const isList = (node: ParsedNode): boolean => node.nodeType === "text" && node.list === true

// Default visibility per row of a pre-order flattened tree: rows deeper than
// `level` are hidden, and so is everything under a greyed-out subtree, i.e. a
// dimmed (`!matched`) or archived row whose descendants are all greyed out too.
// That root row itself stays visible, so a click on its bullet expands it.
// A visible list (TextNode.list) that is not greyed out always shows its
// children, compacted (compactChildren): a dropped child is hidden and
// `compacted`, and its subtree hidden.
export function defaultVisibility(
  rows: readonly { indent: number; matched: boolean; archived?: boolean; node: ParsedNode }[],
  level: number,
): RowVisibility[] {
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

  // Forward list pass: kept children that are lists themselves are reached later in the same pass.
  const compacted = new Array<boolean>(rows.length).fill(false)
  for (let i = 0; i < rows.length; i++) {
    if (!visible[i] || fullyGrey[i] || !isList(rows[i].node)) continue
    const k = rows[i].indent
    const children: number[] = []
    let end = i + 1
    for (; end < rows.length && rows[end].indent > k; end++) {
      if (rows[end].indent === k + 1) children.push(end)
    }
    const keep = compactChildren(children.map(c => !fullyGrey[c]))
    children.forEach((c, j) => {
      if (keep[j]) {
        visible[c] = true
        return
      }
      visible[c] = false
      compacted[c] = true
      for (let d = c + 1; d < end && rows[d].indent > k + 1; d++) visible[d] = false
    })
  }
  return visible.map((v, i) => ({ visible: v, compacted: compacted[i] }))
}

export type BlockFooter = { listIndex: number; hidden: number; indent: number }

/** "+N more" footers, keyed by the `index` of the row each follows (the last visible row in its list's subtree),
 *  innermost list first. A list row gets one when it is visible, at least one direct child is visible, and `hidden`
 *  = its direct children with `compacted && !visible` is > 0. `indent` = the list's indent + 1. */
export function blockFooters(
  rows: readonly { indent: number; visible: boolean; compacted?: boolean; index: number; node: ParsedNode }[],
): Map<number, BlockFooter[]> {
  const footers = new Map<number, BlockFooter[]>()
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row.visible || !isList(row.node)) continue
    let hidden = 0
    let lastVisible = -1
    let childVisible = false
    for (let j = i + 1; j < rows.length && rows[j].indent > row.indent; j++) {
      if (rows[j].visible) lastVisible = j
      if (rows[j].indent !== row.indent + 1) continue
      if (rows[j].visible) childVisible = true
      else if (rows[j].compacted) hidden++
    }
    if (!childVisible || hidden === 0) continue
    const footer: BlockFooter = { listIndex: row.index, hidden, indent: row.indent + 1 }
    const key = rows[lastVisible].index
    const at = footers.get(key)
    if (at) at.unshift(footer)
    else footers.set(key, [footer])
  }
  return footers
}
