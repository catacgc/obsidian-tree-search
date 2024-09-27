import {DirectedGraphOfNotes, NodeAttributes} from "./graph";
import Graph from "graphology";
import {matchQuery, parseQuery, SearchExpr} from "./query";


export type ResultNode = {
	value: string,
	attrs: NodeAttributes,
	children: ResultNode[],
	parents: string[]
}

function filterTreeByWord(node: ResultNode, expr: SearchExpr): ResultNode | null {
	// Check if the current node contains the expr
	if (matchQuery(node.attrs.searchKey, expr)) {
		return node;
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

function traverseChildren(graph: DirectedGraphOfNotes, node: ResultNode, depth: number, traversedAlready: Set<string>) {
	if (depth > 3) return

	if (traversedAlready.has(node.value)) return
	traversedAlready.add(node.value);

	const neighbours = graph.outboundEdgeEntries(node.value)

	for (const edge of neighbours) {

		if (traversedAlready.has(edge.target)) continue

		// const attrs = graph.getNodeAttributes(edge.target)
		const newNode = {
			value: edge.target,
			children: [],
			attrs: {...edge.targetAttributes, ...{ location: edge.attributes.location}}, // always point where the edge was discovered
			parents: getParents(graph, edge.target),
		}

		node.children.push(newNode)

		traverseChildren(graph, newNode, depth + 1, traversedAlready)
	}
}

function getParents(graph: Graph, node: string) {
	const parents = []
	for (const parent of graph.inboundNeighborEntries(node)) {
		parents.push(parent.neighbor)
	}
	return parents;
}

export function searchIndex(graph: DirectedGraphOfNotes, qs: string, separator = ">"): ResultNode[] {
	if (qs.length < 3) return []

	const expressions = qs.split(separator)
		.map(w => w.toLowerCase().trim())
		.map(it => parseQuery(it))

	const filtered: ResultNode[] = []

	const pageNodes = graph.filterNodes((_, attrs) =>
		attrs.nodeType == "page" &&
		matchQuery(attrs.searchKey, expressions[0]))
		.sort((a, b) => a.length - b.length)

	const textNodes = graph.filterNodes((_, attrs) =>
		attrs.nodeType != "page" &&
		matchQuery(attrs.searchKey, expressions[0]))
		.sort((a, b) => a.length - b.length) // always favour traversal of shorter matches first

	const traversed = new Set<string>()

	for (const node of [...pageNodes, ...textNodes]) {
		const attrs = graph.getNodeAttributes(node)
		const newNode = {
			value: node,
			children: [],
			attrs: attrs,
			parents: getParents(graph, node)
		}

		filtered.push(newNode)
		traverseChildren(graph, newNode, 0, traversed)
	}

	return filterDown(filtered, expressions.slice(1))
		.sort((a, b) => b.children.length - a.children.length)
}
