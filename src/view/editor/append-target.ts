// What `>` in the search input anchors an append chain to (EditorMolecule.pushChainAtom): pure, so it is unit-tested.
import {type ParsedNode, type TextNode} from "@mdtree/core"

export type AppendPick =
    | {kind: "refuse"}
    | {kind: "draft"}
    | {kind: "link"; name: string}
    | {kind: "line"; node: TextNode}

/** The whole trimmed query is one closed `[[name]]` or `[[name|alias]]`: the trimmed name; else null. */
export function closedLinkName(query: string): string | null {
    const name = /^\[\[([^[\]|]+)(?:\|[^[\]]*)?\]\]$/.exec(query.trim())?.[1].trim()
    return name ? name : null
}

/** What `>` in the search input appends to: the selected row (`node`, archive rows excluded by the caller); without
 *  a row, a query that is one closed `[[name]]` (a note that may not exist yet), else today's draft. */
export function appendPickFor(node: ParsedNode | null, query: string, dailyBasename: string): AppendPick {
    if (node) {
        switch (node.nodeType) {
            case "page":
                return node.page.toLowerCase() === dailyBasename.toLowerCase() ? {kind: "draft"} : {kind: "link", name: node.page}
            case "header":
                return {kind: "link", name: `${node.page}#${node.header}`}
            case "text":
                return {kind: "line", node}
            default:
                return {kind: "refuse"}
        }
    }
    const name = closedLinkName(query)
    if (name !== null) return {kind: "link", name}
    return {kind: "draft"}
}
