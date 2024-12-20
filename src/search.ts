import {DirectedGraphOfNotes, NodeAttributes} from "./graph";
import Graph from "graphology";
import {matchQuery, parseQuery, SearchExpr} from "./query";
import {TFile} from "obsidian";

export type ResultNode = {
    value: string,
    attrs: NodeAttributes,
    children: ResultNode[],
    parents: string[]
}

function filterTreeByWord(node: ResultNode, expr: SearchExpr): ResultNode | null {
    if (matchQuery(node.attrs, expr)) {
        return node
    }

    // Recursively filter the children
    const filteredChildren = node.children
        .map(child => filterTreeByWord(child, expr))
        .filter(child => child !== null) as ResultNode[];

    // If no children contain the expr, return null
    if (filteredChildren.length === 0) {
        return null;
    }

    // Return a new node with the filtered children
    return {
        ...node,
        children: filteredChildren
    };
}

function filterDown(results: ResultNode[], search: SearchExpr[]): ResultNode[] {
    if (search.length === 0) return results

    const expr = search[0]

    const filtered = results
        .map(r => filterTreeByWord(r, expr))
        .filter(child => child !== null) as ResultNode[]

    return filterDown(filtered, search.slice(1))
}


function buildTree(node: string, graph: DirectedGraphOfNotes, roots: Map<string, ResultNode>, traversedAlready: Set<string>): ResultNode {
    traversedAlready.add(node); 

    const newNode: ResultNode = {
        value: node,
        children: [],
        attrs: graph.getNodeAttributes(node),
        parents: []
    };

    const neighbours = graph.outboundEdgeEntries(node)

    for (const edge of neighbours) {
        // return existing tree built from root and add it as a child to the current node
        let childNode: ResultNode | null = null
        if (roots.has(edge.target)) {
            childNode = roots.get(edge.target)!
            roots.delete(edge.target)
        }

        if (traversedAlready.has(edge.edge)) continue
        traversedAlready.add(edge.edge)

        if (!childNode) {
            childNode = buildTree(edge.target, graph, roots, traversedAlready)
        }

        childNode.attrs = {...childNode.attrs, ...{location: edge.attributes.location}}

        newNode.children.push(childNode)
    }

    return newNode
}

function getParents(graph: Graph, node: string) {
    const parents = []
    for (const parent of graph.inboundNeighborEntries(node)) {
        parents.push(parent.neighbor)
    }
    return parents;
}

export function searchParents(graph: DirectedGraphOfNotes, file: TFile): ResultNode[] {
    const node = `[[${file.basename}]]`.toLowerCase();

    if (!graph.hasNode(node)) return []

    const edges = graph.inboundEdgeEntries(node)

    const filtered: ResultNode[] = []

    for (const edge of edges) {
        const attrs = graph.getNodeAttributes(edge.source)

        const newNode = {
            value: edge.source,
            children: [],
            attrs: {...attrs, ...{location: edge.attributes.location}},
            parents: [],
            index: 0
        }
        filtered.push(newNode)
    }

    return filtered
}


export function advancedSearch(graph: DirectedGraphOfNotes,
                               file: TFile,
                               maxDepth = 3,
                               heading?: string, 
                               query?: string,
                               separator = '.'): ResultNode[] {
    let node = `[[${file.basename}]]`.toLowerCase();
    if (heading) {
        node = `${file.basename}#${heading}`.toLowerCase();
    }

    if (!graph.hasNode(node)) return []

    const tree = buildTree(node, graph, new Map<string, ResultNode>(), new Set<string>())

    if (query) {
        const expressions = query.split(separator)
            .map(w => w.toLowerCase().trim())
            .map(it => parseQuery(it))
        return filterDown(tree.children, expressions)
    }

    return tree.children
}


export function flattenTasks(nodes: ResultNode[]): IndexedResult {

    function search(children: ResultNode[], result: ResultNode[], parent?: ResultNode) {
        for (const node of children) {
            if (node.attrs.nodeType == "task") {
                node.attrs.tokens.push(...parent?.attrs.tokens || [])
                result.push(node)
            }

            search(node.children, result, node)
        }
    }

    const result: ResultNode[] = []
    search(nodes, result)

    return {nodes: result, total: 0}
}

export type IndexedResult = { nodes: ResultNode[], total: number }


export function searchIndex(graph: DirectedGraphOfNotes, qs: string, separator = ">"): ResultNode[] {
    if (qs.length < 3) return []

    const expressions = qs.split(separator)
        .map(w => w.toLowerCase().trim())
        .map(it => parseQuery(it))

    const roots = new Map<string, ResultNode>()

    const firstPageCandidates = graph
        .filterNodes((_, attrs) => matchQuery(attrs, expressions[0]))
        .sort((a, b) => a.length - b.length)

    const traversed = new Set<string>()

    for (const node of firstPageCandidates) {
        if (roots.has(node) || traversed.has(node)) continue

        const newNode = buildTree(node, graph, roots, traversed)

        roots.set(node, newNode)
    }

    const sorted = filterDown(Array.from(roots.values()), expressions.slice(1))
        .sort((a, b) => b.children.length - a.children.length);

    return sorted
}

export type SearchQuery = {
    query: string,
    file?: string,
    heading?: string
}
