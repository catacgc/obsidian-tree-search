import { NotesGraph, getKey } from "../graph/graph.ts"
import type { ParsedNode } from "../graph/types.ts"
import { DEFAULT_SETTINGS, indexSinglePage } from "../graph/indexer.ts"
import { parseVaultFile } from "../parser/vault-file.ts"
import { matchQuery, type QueryExpr } from "./query.ts"
import type { ResultNode } from "./search.ts"

// What the outline editor's filter sees of lines that aren't indexed yet: the node one raw line would become, and
// which edited lines (and result rows) a filter would hide.

/** The node the index would make for one raw markdown line `raw` (a list item, possibly indented, or a heading) at
 *  `line` of `path`: a text node, a page node for a line that is only a link (`- [[X]]`, as createVirtualPage makes),
 *  or a header node for a heading; null for a line the index skips (plain prose bullets, see indexer shouldSkip) or
 *  anything else. Built by parsing the dedented line as a one-line note named after `path` (parseVaultFile +
 *  indexSinglePage into a fresh NotesGraph with DEFAULT_SETTINGS and `archiveTag`), then taking the node at line 0
 *  that is not the note's own page node; its `location` is set to `path`/`line`, and a text node gets
 *  `nested: true` when `nested`. */
export function lineNode(
  raw: string,
  path: string,
  line: number,
  nested: boolean,
  archiveTag = DEFAULT_SETTINGS.archiveTag,
): ParsedNode | null {
  const dedented = raw.trimStart()
  const indent = raw.length - dedented.length
  const graph = new NotesGraph()
  const page = indexSinglePage(parseVaultFile(dedented, path, 0, archiveTag), graph, { ...DEFAULT_SETTINGS, archiveTag })
  if (!page) return null
  const pageKey = getKey(page)
  for (const edge of graph.outboundEdgeEntries(pageKey)) {
    if (edge.target === pageKey) continue
    const node = graph.getNodeAttributes(edge.target)
    const { start, end } = node.location.position
    if (start.line !== 0) continue
    const location = {
      path,
      position: { start: { line, ch: start.ch + indent }, end: { line, ch: end.ch + indent } },
    }
    return node.nodeType === "text" && nested ? { ...node, location, nested: true } : { ...node, location }
  }
  return null
}

/** True when `node` matches every stage (matchQuery); an empty `stages` matches anything, including null. A null
 *  node with stages never matches. */
export function lineMatches(node: ParsedNode | null, stages: QueryExpr[]): boolean {
  return stages.length === 0 || (node !== null && stages.every(s => matchQuery(node, s)))
}

/** Which lines of an edited block a filter would hide. `lines` are in order with depths (0 = the edited line's depth;
 *  the block's first line is the edited line itself). For each stage s, line i is kept when it matches s
 *  (matchQuery, null never matches), or a line above it in its own ancestor chain within the block matches s, or a
 *  line in its subtree within the block matches s, or `context.above[s]` (the edited row's tree ancestors match s),
 *  or — for the first line only — `context.below[s]` (the edited row's existing tree descendants match s). A line is
 *  a miss when some stage doesn't keep it. Empty `stages`: no misses. */
export function blockMisses(
  lines: { depth: number; node: ParsedNode | null }[],
  stages: QueryExpr[],
  context: { above: boolean[]; below: boolean[] },
): boolean[] {
  // A line's parent: the nearest preceding line with a smaller depth (-1: none in the block).
  const parent = lines.map((l, i) => {
    let j = i - 1
    while (j >= 0 && lines[j].depth >= l.depth) j--
    return j
  })
  // A line's subtree end (exclusive): the next line at its depth or shallower.
  const subtreeEnd = lines.map((l, i) => {
    let j = i + 1
    while (j < lines.length && lines[j].depth > l.depth) j++
    return j
  })
  const misses = lines.map(() => false)
  stages.forEach((stage, s) => {
    const matches = lines.map(l => l.node !== null && matchQuery(l.node, stage))
    lines.forEach((_, i) => {
      if (matches[i] || context.above[s] || (i === 0 && context.below[s])) return
      for (let p = parent[i]; p >= 0; p = parent[p]) if (matches[p]) return
      for (let d = i + 1; d < subtreeEnd[i]; d++) if (matches[d]) return
      misses[i] = true
    })
  })
  return misses
}

/** `nodes` narrowed by each stage in turn, as advancedSearch's filterDown narrows (a node matching the stage keeps its
 *  whole subtree; a node with a kept descendant stays with only its kept children), except that a node for which
 *  `pinned(node)` is true and which would otherwise be dropped is kept with its whole subtree and `miss: true`. A
 *  `miss` set by an earlier stage stays. Empty `stages` returns `nodes` unchanged. Does not mutate inputs. */
export function filterOutline(nodes: ResultNode[], stages: QueryExpr[], pinned: (node: ParsedNode) => boolean): ResultNode[] {
  function narrow(r: ResultNode, stage: QueryExpr): ResultNode | null {
    if (matchQuery(r.node, stage)) return r
    const children = r.children.map(c => narrow(c, stage)).filter((c): c is ResultNode => c !== null)
    if (children.length > 0) return { ...r, children }
    return pinned(r.node) ? { ...r, miss: true } : null
  }
  return stages.reduce(
    (kept, stage) => kept.map(r => narrow(r, stage)).filter((r): r is ResultNode => r !== null),
    nodes,
  )
}
