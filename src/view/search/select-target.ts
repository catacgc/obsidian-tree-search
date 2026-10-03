// Re-finding a result row after its results were recomputed (a save, a reindex,
// a modal remount): by the location it was written at, then by its graph key.
import {getKey} from "@mdtree/core"
import type {TreeNode} from "./SearchViewFlatten"

export type RowTarget = { path: string; line: number } | { key: string }

/** Targets that re-find `row` after a recompute: its location, then its graph key. [] for the synthetic archive row. */
export function rowTargets(row: TreeNode): RowTarget[] {
    if (row.archiveRow) return []
    const {path, position} = row.node.location
    return [{path, line: position.start.line}, {key: getKey(row.node)}]
}

function matches(row: TreeNode, target: RowTarget): boolean {
    if ("key" in target) return getKey(row.node) === target.key
    const {path, position} = row.node.location
    return path === target.path && position.start.line === target.line
}

/** Position in `nodes` of the first non-archive row matching the earliest matching target (targets are in preference order), else -1. */
export function findTargetRow(nodes: TreeNode[], targets: RowTarget[]): number {
    for (const target of targets) {
        const i = nodes.findIndex(row => !row.archiveRow && matches(row, target))
        if (i >= 0) return i
    }
    return -1
}

/** Copy of `nodes` with row `i` and each ancestor (walking back to strictly smaller `indent`) set visible. */
export function revealRow(nodes: TreeNode[], i: number): TreeNode[] {
    const out = nodes.slice()
    let indent = out[i].indent
    out[i] = {...out[i], visible: true}
    for (let j = i - 1; j >= 0 && indent > 0; j--) {
        if (out[j].indent >= indent) continue
        indent = out[j].indent
        out[j] = {...out[j], visible: true}
    }
    return out
}
