import {DirectedGraphOfNotes, EdgeAttributes, GraphAttributes, Index, NodeAttributes} from "./tree-builder";
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
	if (matchQuery(node.value, expr)) {
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

function traverseChildren(graph: DirectedGraphOfNotes, node: ResultNode, depth: number, allChildren: Set<string>) {
	if (depth > 2) return

	const neighbours = graph.outboundNeighborEntries(node.value)

	for (const n of neighbours) {
		const attrs = graph.getNodeAttributes(n.neighbor)
		const newNode = {
			value: n.neighbor,
			children: [],
			attrs: attrs,
			parents: getParents(graph, n.neighbor)
		}

		allChildren.add(n.neighbor)
		node.children.push(newNode)

		traverseChildren(graph, newNode, depth + 1, allChildren)
	}
}

function getParents(graph: Graph, node: string) {
	const parents = []
	for (const parent of graph.inboundNeighborEntries(node)) {
		parents.push(parent.neighbor)
	}
	return parents;
}

export function searchIndex(graph: DirectedGraphOfNotes, qs: string): ResultNode[] {
	if (qs.length < 3) return []

	const treeWords = qs.split(">")
		.map(w => w.toLowerCase().trim())
		.map(it => parseQuery(it))

	const filtered: ResultNode[] = []

	const nodes = graph.filterNodes(n => matchQuery(n, treeWords[0]))
	const allChildren = new Set<string>()

	for (const node of nodes) {
		const attrs = graph.getNodeAttributes(node)
		const newNode = {
			value: node,
			children: [],
			attrs: attrs,
			parents: getParents(graph, node)
		}

		filtered.push(newNode)
		traverseChildren(graph, newNode, 0, allChildren)
	}

	return filterDown(filtered, treeWords.slice(1)).filter(f => !allChildren.has(f.value))
		.sort((a, b) => b.children.length - a.children.length)
}


