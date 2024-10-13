import {DirectedGraphOfNotes, NodeAttributes} from "./graph";
import Graph from "graphology";
import {matchQuery, parseQuery, SearchExpr} from "./query";
import {TFile} from "obsidian";


export type ResultNode = {
    index: number,
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

function traverseChildren(graph: DirectedGraphOfNotes, node: ResultNode, depth: number, traversedAlready: Set<string>, maxDepth = 4) {
    if (depth >= maxDepth) return

    if (traversedAlready.has(node.value)) return

    if (graph.outDegree(node.value) > 0)
        traversedAlready.add(node.value); // add only tree nodes to the traversed set

    const neighbours = graph.outboundEdgeEntries(node.value)

    for (const edge of neighbours) {

        if (traversedAlready.has(edge.target)) continue

        // const attrs = graph.getNodeAttributes(edge.target)
        const newNode = {
            value: edge.target,
            children: [],
            attrs: {...edge.targetAttributes, ...{location: edge.attributes.location}}, // always point where the edge was discovered
            parents: getParents(graph, edge.target),
			index: 0
        }

        node.children.push(newNode)

        traverseChildren(graph, newNode, depth + 1, traversedAlready, maxDepth)
    }
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

export function dfs(query: SearchExpr, graph: DirectedGraphOfNotes, node: string, traversed: Set<string>, maxCount = 300): [ResultNode | null, "has" | "not"] {
    if (traversed.size > maxCount || traversed.has(node)) return [null, "not"];

    if (!graph.hasNode(node)) return [null, "not"];

    traversed.add(node);

    const newNode: ResultNode = {
        value: node,
        children: [],
        attrs: graph.getNodeAttributes(node),
        parents: [],
        index: 0
    };

    const nodeMatchesQuery = matchQuery(newNode.attrs, query);
    let childHas = false;

    for (const edge of graph.outboundEdgeEntries(node)) {
        const [childNode, childStatus] = dfs(query, graph, edge.target, traversed, maxCount);
        if ((childStatus === "has" || nodeMatchesQuery) && childNode) {
            newNode.children.push(childNode);
            childHas = true;
        }
    }

    return [newNode, nodeMatchesQuery || childHas ? "has" : "not"];
}

export function advancedSearch(graph: DirectedGraphOfNotes,
                               file: TFile,
                               maxDepth = 3,
                               heading?: string, query?: string): ResultNode[] {
    let node = `[[${file.basename}]]`.toLowerCase();
    if (heading) {
        node = `${file.basename}#${heading}`.toLowerCase();
    }

    if (query) {
        const expr = parseQuery(query)
        const results = dfs(expr, graph, node, new Set<string>(), 30000)
        return results[0] ? results[0].children : []
    }

    return searchChildren(graph, file, maxDepth, heading)
}


export function searchChildren(graph: DirectedGraphOfNotes,
                               file: TFile,
                               maxDepth = 3,
                               heading?: string): ResultNode[] {

    const filtered: ResultNode[] = []

    let node = `[[${file.basename}]]`.toLowerCase();
    if (heading) {
        node = `${file.basename}#${heading}`.toLowerCase();
    }

    if (!graph.hasNode(node)) return []

    const pageEdges = graph.outboundEdgeEntries(node)
    const traversed = new Set<string>()

    for (const edge of [...pageEdges]) {
        const attrs = graph.getNodeAttributes(edge.target)
        const newNode = {
            value: edge.target,
            children: [],
            attrs: {...attrs, ...{location: edge.attributes.location}},
            parents: [],
			index: 0
        }

        filtered.push(newNode)
        traverseChildren(graph, newNode, 0, traversed, maxDepth)
    }

    return filtered
}

function indexResultsInline(nodes: ResultNode[], index = 0): number {
    let i = index
    for (const node of nodes) {
        node.index = i
        i++
        i = indexResultsInline(node.children, i)
    }
    return i
}

export function index(nodes: ResultNode[]): IndexedResult  {
    const total = indexResultsInline(nodes)

    return {nodes: nodes, total: total}
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
    const total = indexResultsInline(result)

    return {nodes: result, total: total}
}

export type IndexedResult = { nodes: ResultNode[], total: number }

export function searchIndex(graph: DirectedGraphOfNotes, qs: string, separator = ">", maxDepth = 3): IndexedResult {
    if (qs.length < 3) return {nodes: [], total: 0}

    const expressions = qs.split(separator)
        .map(w => w.toLowerCase().trim())
        .map(it => parseQuery(it))

    const filtered: ResultNode[] = []

    const pageNodes = graph.filterNodes((_, attrs) =>
        attrs.nodeType == "page" &&
        matchQuery(attrs, expressions[0]))
        .sort((a, b) => a.length - b.length)

    const textNodes = graph.filterNodes((_, attrs) =>
        attrs.nodeType != "page" &&
        matchQuery(attrs, expressions[0]))
        .sort((a, b) => a.length - b.length) // always favour traversal of shorter matches first

    const traversed = new Set<string>()

    for (const node of [...pageNodes, ...textNodes]) {
        const attrs = graph.getNodeAttributes(node)
        const newNode = {
            value: node,
            children: [],
            attrs: attrs,
            parents: getParents(graph, node),
			index: 0
        }

        filtered.push(newNode)
        traverseChildren(graph, newNode, 0, traversed, maxDepth)
    }

    const sorted = filterDown(filtered, expressions.slice(1))
        .sort((a, b) => b.children.length - a.children.length);

    return index(sorted)
}

export type SearchQuery = {
    query: string,
    file?: string,
    heading?: string
}
