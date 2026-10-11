import type { ParsedNode } from "../graph/types.ts"
import type { ResultNode } from "./search.ts"
import { getKey, type NotesGraph } from "../graph/graph.ts"
import { containsEmoji, isUndated, UNDATED_AGE } from "../graph/boost.ts"
import { matchQuery, nodeMatchesQuery, type QueryExpr } from "./query.ts"
import { compareOpenTasks, isOpenTask } from "./task-order.ts"
import { compactChildren, compareSiblings } from "./flatten.ts"

export type TimelineItem = {
  node: ParsedNode
  breadcrumb: ParsedNode[]   // matched ancestors, root-first
  pinned: boolean            // emoji-boosted (containsEmoji(searchKey))
  archived: boolean          // ResultNode.effectiveArchived ?? false
  ageDays: number            // node.ageDays, or the fallback's age when undated
  block?: BlockLine[]        // the block root's lines (pre-order, depth 1 = direct child) when node is a block root
}

export type BlockLine = { node: ParsedNode; depth: number; matched: boolean; preview: boolean }

/** Lines under a block root, descending only through text nodes, siblings in compareSiblings order. `matched` =
 *  target === undefined || matchQuery(node, target). `preview` = parent line previewed (depth 1: true) and kept by
 *  compactChildren over its siblings' brightness (matched or any matched descendant line). */
function blockLines(root: ResultNode, target: QueryExpr | undefined): BlockLine[] {
  const lines: BlockLine[] = []
  const matches = (n: ParsedNode) => target === undefined || matchQuery(n, target)
  const bright = (r: ResultNode): boolean => matches(r.node) || (r.node.nodeType === "text" && r.children.some(bright))
  const walk = (r: ResultNode, depth: number, previewed: boolean): void => {
    const kids = [...r.children].sort(compareSiblings)
    const keep = compactChildren(kids.map(bright))
    kids.forEach((k, i) => {
      const preview = previewed && keep[i]
      lines.push({ node: k.node, depth, matched: matches(k.node), preview })
      if (k.node.nodeType === "text") walk(k, depth + 1, preview)
    })
  }
  walk(root, 1, true)
  return lines
}

// Flat, date-ordered projection of a search result tree. Items are the nodes
// that themselves match the last query stage — the rows the tree highlights
// for that stage. Context the tree keeps but dims (a hit's non-matching
// subtree, ancestors kept only for earlier stages) is not an item; matched
// ancestors become the breadcrumb. Emoji-bearing nodes are pinned on top but,
// like `in:`, stay subject to the recency window. `fallbackAgeDays` dates
// undated nodes (the host supplies e.g. the containing file's ctime; core stays
// filesystem-agnostic); nodes it cannot date are dropped unless pinned and no
// window is set.
export function buildTimeline(
  results: ResultNode[],
  stages: QueryExpr[],
  windowDays: number | null = null,
  fallbackAgeDays?: (node: ParsedNode) => number | null,
): TimelineItem[] {
  const target = stages[stages.length - 1]
  const items = new Map<string, TimelineItem>()
  const ancestors: ParsedNode[] = []

  // A hit inside a list block (a text line with `list`, and the text lines below it) is shown as one item: the
  // block root with its lines (BlockLine). `depth` is ancestors.length when the block root was entered.
  type Block = { r: ResultNode; depth: number }
  const visit = (r: ResultNode, block: Block | null): void => {
    const node = r.node
    const here = block ?? (node.nodeType === "text" && node.list ? { r, depth: ancestors.length } : null)
    const hit = target === undefined || matchQuery(node, target)
    if (hit && node.nodeType !== "pointer") {
      const item = here?.r ?? r
      const shown = item.node
      const pinned = containsEmoji(shown.searchKey)
      const ageDays = isUndated(shown.ageDays) ? (fallbackAgeDays?.(shown) ?? UNDATED_AGE) : shown.ageDays
      if (windowDays === null ? pinned || !isUndated(ageDays) : ageDays <= windowDays) {
        const breadcrumb = ancestors
          .slice(0, here?.depth ?? ancestors.length)
          .filter(a => a.nodeType !== "pointer" && nodeMatchesQuery(a, stages))
        const key = getKey(shown)
        const existing = items.get(key)
        const archived = item.effectiveArchived ?? false
        if (existing === undefined) {
          items.set(key, {
            node: shown, breadcrumb, pinned, archived, ageDays,
            ...(here ? { block: blockLines(here.r, target) } : {}),
          })
        } else if (breadcrumb.length > existing.breadcrumb.length) {
          existing.node = shown
          existing.breadcrumb = breadcrumb
          existing.archived = archived
          existing.ageDays = ageDays
          if (here) existing.block = blockLines(here.r, target)
          else delete existing.block
        }
      }
    }
    if (r.children.length === 0) return
    ancestors.push(node)
    for (const child of r.children) visit(child, node.nodeType === "text" ? here : null)
    ancestors.pop()
  }

  for (const r of results) visit(r, null)

  // Pinned first; then open tasks oldest first (overdue before future); then the rest newest first.
  return [...items.values()].sort((a, b) =>
    (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1) ||
    compareOpenTasks(a.node, a.ageDays, b.node, b.ageDays) ||
    (isOpenTask(a.node) ? 0 : a.ageDays - b.ageDays) ||
    b.node.boost - a.node.boost,
  )
}

// Outline parent of a text line or header inside its own note: the enclosing
// header, the parent bullet, or the note itself. Search results start at the
// matched node, so this is the context shown when no matched ancestor exists.
// Inline parent edges (`EdgeAttributes.inline`, from the notes a line links)
// are skipped.
export function fileParent(graph: NotesGraph, node: ParsedNode): ParsedNode | null {
  if (node.nodeType !== "text" && node.nodeType !== "header") return null
  for (const e of graph.inboundEdgeEntries(getKey(node))) {
    if (e.attributes.type !== "parent" || e.attributes.inline || e.attributes.location.path !== node.location.path) continue
    const parent = graph.getNodeAttributes(e.source)
    if (parent.nodeType !== "pointer") return parent
  }
  return null
}

/** The outline parent to show as context for `node` displayed under `shownParent`, when `shownParent` is one of its
 *  inline parents (the line links it): `fileParent(graph, node)`, else null. Also null when that adds nothing: it is
 *  `shownParent` itself, or the note of a linked heading (`[[Note#Heading]]` already renders "Note > Heading"). */
export function outlineContext(graph: NotesGraph, node: ParsedNode, shownParent: ParsedNode): ParsedNode | null {
  if (node.nodeType !== "text") return null
  const from = getKey(shownParent)
  const edge = graph.inboundEdgeEntries(getKey(node)).find(e => e.source === from && e.attributes.type === "parent")
  if (!edge?.attributes.inline) return null
  const outline = fileParent(graph, node)
  if (!outline) return null
  const key = getKey(outline)
  if (key === from) return null
  if (shownParent.nodeType === "header" && key === `[[${shownParent.page.toLowerCase()}]]`) return null
  return outline
}
