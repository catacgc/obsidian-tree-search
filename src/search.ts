import {EdgeAttributes, GraphAttributes, Index, NodeAttributes} from "./tree-builder";
import Graph from "graphology";

export type ResultNode = {
	value: string,
	attrs: NodeAttributes,
	children: ResultNode[],
	parents: string[]
}

type GF = Graph<NodeAttributes, EdgeAttributes, GraphAttributes>

function filterTreeByWord(node: ResultNode, word: string): ResultNode | null {
	// Check if the current node contains the word
	if (node.value.includes(word)) {
		return node;
	}

	// Recursively filter the children
	const filteredChildren = node.children
		.map(child => filterTreeByWord(child, word))
		.filter(child => child !== null) as ResultNode[];

	// If no children contain the word, return null
	if (filteredChildren.length === 0) {
		return null;
	}

	// Return a new node with the filtered children
	return {
		...node,
		children: filteredChildren
	};
}

function filterDown(results: ResultNode[], words: string[]): ResultNode[] {
	if (words.length === 0) return results

	const word = words[0]

	const filtered = results
		.map(r => filterTreeByWord(r, word))
		.filter(child => child !== null) as ResultNode[]

	return filterDown(filtered, words.slice(1))
}

function traverseChildren(graph: GF, node: ResultNode, depth: number, allChildren: Set<string>) {
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


export function searchIndex(index: Index, qs: string): ResultNode[] {
	if (qs.length < 3) return []

	const words = qs.split(">")
		.map(w => w.toLowerCase().trim())
	const anchor = words.length > 0 ? words[0] : ""
	const filtered: ResultNode[] = []

	const nodes = index.graph.filterNodes(n => n.toLowerCase().includes(anchor))
	const allChildren = new Set<string>()

	for (const node of nodes) {
		const attrs = index.graph.getNodeAttributes(node)
		const newNode = {
			value: node,
			children: [],
			attrs: attrs,
			parents: getParents(index.graph, node)
		}

		filtered.push(newNode)
		traverseChildren(index.graph, newNode, 0, allChildren)
	}

	return filterDown(filtered, words.slice(1)).filter(f => !allChildren.has(f.value))
}
