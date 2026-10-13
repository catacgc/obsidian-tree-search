// The cut drawer (⌘X): rows collected from the search views for a bulk Move under… or Archive.
import {findSubtreeEnd, getKey, splitLines, type NotesGraph, type ParsedNode} from "@mdtree/core"
import type {RowRef} from "./chain"

/** A drawer item's identity: the node's graph key; a folder note row stands for its folder. */
export function cutKeyOf(node: ParsedNode): string {
    return node.nodeType === "folderNote" ? getKey(node.folder) : getKey(node)
}

/** `items` without the item keyed like `ref` when present, else with `ref` appended. */
export function toggleCut(items: readonly RowRef[], ref: RowRef): RowRef[] {
    const key = cutKeyOf(ref.node)
    const rest = items.filter(r => cutKeyOf(r.node) !== key)
    return rest.length < items.length ? rest : [...items, ref]
}

/** `items` minus every item whose cutKeyOf is among `done`'s. */
export function removeCut(items: readonly RowRef[], done: readonly RowRef[]): RowRef[] {
    const keys = new Set(done.map(r => cutKeyOf(r.node)))
    return items.filter(r => !keys.has(cutKeyOf(r.node)))
}

/** `node` as currently indexed: a text node is looked up again by its key, so earlier edits that shifted its line are
 *  followed. Null when the key is gone or is no longer a text node. Other nodes are returned unchanged. */
export function currentNode(graph: NotesGraph, node: ParsedNode): ParsedNode | null {
    if (node.nodeType !== "text") return node
    const key = getKey(node)
    if (!graph.hasNode(key)) return null
    const current = graph.getNodeAttributes(key)
    return current.nodeType === "text" ? current : null
}

/** Items another item carries along, keyed by cutKeyOf, each mapped to its outermost carrier's key (itself never
 *  carried): a text item whose line lies strictly inside another text item's subtree in the same file (lines from
 *  `contents`; a missing path carries nothing), and a folder, attachment or page item whose path lies inside a folder
 *  item. A carried item succeeds or fails with its carrier. */
export function cutCarriers(items: readonly RowRef[], contents: ReadonlyMap<string, string>, filePathOf: (node: ParsedNode) => string | null): Map<string, string> {
    const carriers = new Map<string, string>()
    const byPath = new Map<string, ParsedNode[]>()
    for (const {node} of items) {
        if (node.nodeType === "text") byPath.set(node.location.path, [...byPath.get(node.location.path) ?? [], node])
    }
    for (const [path, nodes] of byPath) {
        const content = contents.get(path)
        if (content === undefined || nodes.length < 2) continue
        const lines = splitLines(content).lines
        const spans = nodes.map(n => {
            const line = n.location.position.start.line
            return {key: getKey(n), line, end: line < lines.length ? findSubtreeEnd(lines, line) : line + 1}
        })
        for (const s of spans) {
            // The outermost container starts first.
            const outer = spans.filter(o => s.line > o.line && s.line < o.end).sort((a, b) => a.line - b.line)[0]
            if (outer) carriers.set(s.key, outer.key)
        }
    }
    const folders = items.flatMap(r => r.node.nodeType === "folder" ? [r.node] : [])
    for (const {node} of items) {
        if (node.nodeType !== "folder" && node.nodeType !== "attachment" && node.nodeType !== "page") continue
        const path = node.nodeType === "folder" ? node.path : filePathOf(node)
        if (path === null) continue
        // The outermost folder has the shortest path.
        const outer = folders.filter(f => path.startsWith(f.path + "/")).sort((a, b) => a.path.length - b.path.length)[0]
        if (outer) carriers.set(cutKeyOf(node), cutKeyOf(outer))
    }
    return carriers
}

export type CutFailure = {label: string; reason: string}

const NOTICE_FAILURES = 5

/** The Notice after a bulk action over `total` items, `done` of them succeeded: one item stays silent on success and
 *  shows its own reason on failure; more items get a count, then up to five failures. */
export function bulkNotice(verb: "Moved" | "Archived", done: number, total: number, failures: readonly CutFailure[]): string | null {
    if (total === 1) return failures[0]?.reason ?? null
    if (failures.length === 0) return `${verb} ${done} items`
    const shown = failures.slice(0, NOTICE_FAILURES).map(f => `\n${f.label}: ${f.reason}`).join("")
    const more = failures.length > NOTICE_FAILURES ? `\n…and ${failures.length - NOTICE_FAILURES} more` : ""
    return `${verb} ${done} of ${total}.${shown}${more}`
}
