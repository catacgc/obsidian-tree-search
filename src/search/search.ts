import { DirectedGraphOfNotes, ParsedNode } from "../graph";
import { firstPassInclude, matchQuery, parseQuery, QueryExpr } from "./query";
import { TFile } from "obsidian";

export type ResultNode = {
    node: ParsedNode,
    children: ResultNode[],
    parents: string[]
}

function filterTreeByWord(
    node: ResultNode,
    expr: QueryExpr,
    showOnlyMatchingChildren = true,
    pruneMatchingTree = false): ResultNode | null {

    const nodeMatches = matchQuery(node.node, expr)
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

function isPageOrHeaderOrFolder(expr: QueryExpr): boolean {
    return (expr.type == "modifier" && (expr.value == ":page" || expr.value == ":header" || expr.value == ":folder"))
        || (expr.type == "or" && expr.exprs.every(e => isPageOrHeaderOrFolder(e)))
}

function isNegation(expr: QueryExpr): boolean {
    return expr.type == "not" || (expr.type == "and" && expr.exprs.every(e => isNegation(e)))
}

function filterDown(results: ResultNode[], search: QueryExpr[], showOnlyMatchingChildren = false): ResultNode[] {
    if (search.length === 0) return results

    const expr = search[0]

    // showOnlyMatchingChildren = isPageOrHeaderOrFolder(expr)
    showOnlyMatchingChildren = true
    const pruneMatchingTree = isNegation(expr)

    const filtered = results
        .map(r => filterTreeByWord(r, expr, showOnlyMatchingChildren, pruneMatchingTree))
        .filter(r => r !== null) as ResultNode[]

    return filterDown(filtered, search.slice(1), showOnlyMatchingChildren)
}

function buildTree(node: string, graph: DirectedGraphOfNotes, roots: Map<string, ResultNode>, traversedAlready: Set<string>): ResultNode {
    traversedAlready.add(node);

    const newNode: ResultNode = {
        children: [],
        node: graph.getNodeAttributes(node),
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

        childNode.node = { ...childNode.node, ...{ location: edge.attributes.location } }
        childNode.parents.push(newNode.node.location.path)

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
            node: { ...attrs, ...{ location: edge.attributes.location } },
            parents: [],
            index: 0
        }
        filtered.push(newNode)
    }

    return filtered
}


export function advancedSearch(graph: DirectedGraphOfNotes,
    exactRef: string,
    query: string,
    separator: string): ResultNode[] {

    const node = exactRef.toLowerCase()
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
            if (node.node.nodeType == "text" && node.node.isTask && !node.node.isCompleted) {
                // TODO: node.attrs.tokens.push(...parent?.attrs.tokens || []) 
                result.push(node)
            }

            search(node.children, result, node)
        }
    }

    const result: ResultNode[] = []
    search(nodes, result)

    return { nodes: result, total: 0 }
}

export type IndexedResult = { nodes: ResultNode[], total: number }

export function searchIndex(graph: DirectedGraphOfNotes, qs: string, separator: string): ResultNode[] {
    if (qs.length < 3) return []

    const expressions = qs.split(separator)
        .map(w => w.toLowerCase().trim())
        .map(it => parseQuery(it))

    const roots = new Map<string, ResultNode>()

    const firstPass = expressions[0]

    let firstPageCandidates = graph
        .filterNodes((_, attrs) => attrs.nodeType !== "pointer" && firstPassInclude(attrs, firstPass))
        .sort((a, b) => b.length - a.length);

    const traversed = new Set<string>()

    for (const node of firstPageCandidates) {
        if (roots.has(node) || traversed.has(node)) continue

        const newNode = buildTree(node, graph, roots, traversed)

        roots.set(node, newNode)
    }

    const sorted = filterDown(Array.from(roots.values()), expressions.slice(1))
        .sort((a, b) => {
            return b.children.length - a.children.length
        });

    return sorted
}

export type SearchQuery = {
    query: string,
    file?: string,
    heading?: string
}

export function getAllFoldersTree(graph: DirectedGraphOfNotes): ResultNode[] {
    const nodes = graph.mapNodes((key, attrs) => {
        return attrs
    }).filter(it => it.nodeType == "page" || it.nodeType == "folder")

    const nodeMap = new Map<string, ResultNode>()
    const roots: ResultNode[] = []

    // Create ResultNodes for all pages and folders
    nodes.forEach(node => {
        const resultNode: ResultNode = {
            node: node,
            children: [],
            parents: []
        }
        // Use the file path as the key. 
        // For folders, path is "folder/subfolder"
        // For pages, location.path is "folder/subfolder/file.md"
        const path = node.nodeType === "folder" ? node.path : node.location.path
        nodeMap.set(path, resultNode)
    })

    // Build the tree
    for (const resultNode of nodeMap.values()) {
        const node = resultNode.node
        const path = node.nodeType === "folder" ? node.path : node.location.path

        // Find parent path
        const parts = path.split("/")
        if (parts.length > 1) {
            // Has parent
            const parentPath = parts.slice(0, -1).join("/")
            const parentNode = nodeMap.get(parentPath)

            if (parentNode) {
                parentNode.children.push(resultNode)
                resultNode.parents.push(parentPath)
            } else {
                // Parent not found in map (maybe it's a root folder that wasn't created as a node?)
                // Or maybe the parent folder node doesn't exist in the graph for some reason.
                // In this case, treat as root or try to find a higher level parent?
                // For now, let's add to roots if direct parent is missing, 
                // but ideally all folder nodes should exist if they contain files.
                // However, if we just add to roots, we might have a flat list if folders are missing.
                // Let's assume folders exist.
                roots.push(resultNode)
            }
        } else if (parts.length == 1) {
            // Is root
            resultNode.parents.push("/")
            const parentNode = nodeMap.get("/")
            parentNode?.children.push(resultNode)
            // roots.push(resultNode)
        }
        else {
            // Is root
            roots.push(resultNode)
        }
    }

    // Sort children and roots
    const sortFn = (a: ResultNode, b: ResultNode) => {
        // Folders first, then files
        if (a.node.nodeType === "folder" && b.node.nodeType !== "folder") return -1
        if (a.node.nodeType !== "folder" && b.node.nodeType === "folder") return 1

        // Alphabetical
        const nameA = a.node.nodeType === "folder" ? a.node.name : (a.node.nodeType === "page" ? a.node.page : "")
        const nameB = b.node.nodeType === "folder" ? b.node.name : (b.node.nodeType === "page" ? b.node.page : "")
        return nameA.localeCompare(nameB)
    }

    const sortRecursive = (node: ResultNode) => {
        node.children.sort(sortFn)
        node.children.forEach(sortRecursive)
    }

    roots.sort(sortFn)
    roots.forEach(sortRecursive)

    return roots
}
