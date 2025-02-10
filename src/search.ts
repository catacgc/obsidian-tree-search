import {DirectedGraphOfNotes, NodeAttributes} from "./graph";
import Graph from "graphology";
import {firstPassInclude, matchQuery, parseQuery, QueryExpr} from "./query";
import {TFile} from "obsidian";

export type ResultNode = {
    value: string,
    attrs: NodeAttributes,
    children: ResultNode[],
    parents: string[]
}

function filterTreeByWord(
    node: ResultNode, 
    expr: QueryExpr, 
    showOnlyMatchingChildren = false,
    pruneMatchingTree = false): ResultNode | null {
    
    const nodeMatches = matchQuery(node.attrs, expr)
    if (!nodeMatches && pruneMatchingTree) {
        return null
    }

    if (nodeMatches && !showOnlyMatchingChildren && !pruneMatchingTree) {
        return node
    }

    // Recursively filter the children
    const matchingChildren = node.children
        .map(child => filterTreeByWord(child, expr, showOnlyMatchingChildren, pruneMatchingTree))
        .filter(child => child !== null) as ResultNode[];

    // If no children contain the expr and the node itself does not match, return null
    if (!nodeMatches && matchingChildren.length === 0) {
        return null
    }

    // Return a new node with the filtered children
    return {
        ...node,
        children: matchingChildren
    };
}

function isPageOrHeader(expr: QueryExpr): boolean {
    return (expr.type == "modifier" && (expr.value == ":page" || expr.value == ":header"))
    || (expr.type == "or" && expr.exprs.every(e => isPageOrHeader(e)))
}

function isNegation(expr: QueryExpr): boolean {
    return expr.type == "not" || (expr.type == "and" && expr.exprs.every(e => isNegation(e)))
}

function filterDown(results: ResultNode[], search: QueryExpr[], showOnlyMatchingChildren = false): ResultNode[] {
    if (search.length === 0) return results

    const expr = search[0]

    showOnlyMatchingChildren = isPageOrHeader(expr)
    const pruneMatchingTree = isNegation(expr)

    const filtered = results
        .map(r => filterTreeByWord(r, expr, showOnlyMatchingChildren, pruneMatchingTree))
        .filter(r => r !== null) as ResultNode[]

    return filterDown(filtered, search.slice(1), showOnlyMatchingChildren)
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

export function searchIndex(graph: DirectedGraphOfNotes, qs: string, separator = "."): ResultNode[] {
    if (qs.length < 3) return []

    const expressions = qs.split(separator)
        .map(w => w.toLowerCase().trim())
        .map(it => parseQuery(it))

    const roots = new Map<string, ResultNode>()

    const firstPass = expressions[0]

    let firstPageCandidates =  graph
            .filterNodes((_, attrs) => firstPassInclude(attrs, firstPass))
            .sort((a, b) => b.length - a.length);

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

/**
 * Recursively prune the graph for each not operator in the expression
 */
function prune(graph: DirectedGraphOfNotes, expr: QueryExpr): Set<string> {
    // if (expr.type == "not") {
    //     const matches = new Set<string>();
    //     for (const child of expr.expr) {
    //         const pruned = prune(graph, child)
    //         pruned.forEach(node => matches.add(node))
    //     }
    //     return matches
    // }

    if (expr.type != "not") {
        return new Set<string>()
    }

    const matches = new Set<string>();
    const visited = new Set<string>();

    // Find initial matching nodes
    const initialNodes = graph.filterNodes((node, attrs) => !matchQuery(attrs, expr));

    // For each matching node, traverse the graph to find all reachable nodes
    for (const node of initialNodes) {
        if (visited.has(node)) continue;
        traverseAndCollect(node, graph, matches, visited);
    }

    return matches;
}

function traverseAndCollect(
    node: string, 
    graph: DirectedGraphOfNotes, 
    matches: Set<string>,
    visited: Set<string>
) {
    if (visited.has(node)) return;
    visited.add(node);
    matches.add(node);

    // Traverse outbound edges
    for (const neighbor of graph.outNeighbors(node)) {
        traverseAndCollect(neighbor, graph, matches, visited);
    }
}

export type SearchQuery = {
    query: string,
    file?: string,
    heading?: string
}
