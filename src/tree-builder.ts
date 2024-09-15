import Graph from "graphology";
import {Notice} from "obsidian";
import {getAPI} from "obsidian-dataview";
import {parseMarkdown} from "./parser";
import {Token} from "markdown-it";


export type NodeAttributes = {
	location: Location
	tokens: Token[]
	relatedObsidianRefs: string[]
}

export type EdgeAttributes = {
	mtime: number;
	type: "parent" | "related"
}

export type GraphAttributes = {
	name?: string;
}

export type DirectedGraphOfNotes = Graph<NodeAttributes, EdgeAttributes, GraphAttributes>

export type Index = {
	graph: DirectedGraphOfNotes
}

export type Location = {
	path: string,
	position: {
		start: {
			line: number,
			col: number
		},
		end: {
			line: number,
			col: number
		}
	}
}

export type DvList = {
	link: { path: string },
	text: string,
	line: number,
	position: {
		start: {
			line: number,
			col: number
		},
		end: {
			line: number,
			col: number
		}
	}
	parent: number,
	children: DvList[],
	tags: string[],
}

export type DvPage = {
	aliases: string[],
	file: {
		name: string,
		mtime: { ts: number, c: { year: number, month: number, day: number } },
		path: string,
		frontmatter: Record<string, any>,
		lists: { values: DvList[] }
	},
	tags: string[],
}

function addNode(graph: Graph, key: string, attrs: NodeAttributes) {
	const nodeKey = key.toLowerCase();
	if (!graph.hasNode(nodeKey)) {
		graph.addNode(nodeKey, attrs)
	}
}

function addEdge(graph: Graph, from: string, to: string, attrs: EdgeAttributes) {
	const sourceKey = from.toLowerCase();
	const targetKey = to.toLowerCase();
	if (sourceKey == targetKey) {
		return
	}
	if (!graph.hasEdge(sourceKey, targetKey)) {
		graph.addDirectedEdge(sourceKey, targetKey, attrs)
	}
}

// not interested in plain text or random paragraphs
function shouldSkip(lst: DvList) {
	return !lst.text.includes("[[")
		&& !lst.text.includes('![[')
		// && !lst.text.startsWith('#')
		&& !lst.text.includes('http')
		;
}

function getObsidianLinkReference(tokens: Token[]) {
	return tokens.flatMap(children => children.children)
		.filter(it => it?.type == 'obsidian_link')
		.map(it => `[[${it!!.content}]]`)
}

function createPageNodeAttribute(page: DvPage): NodeAttributes {
	const tokens = [...parseMarkdown(`[[${page.file.name}]]`, {})];
	return {
		location: {
			path: page.file.path,
			position: { start: {line: 0, col: 0}, end: {line: 0, col: 0} }
		},
		tokens: tokens,
		relatedObsidianRefs: []
	}
}

function createItemNodeAttributes(page: DvPage, item: DvList) {
	const tokens = [...parseMarkdown(item.text, {})];
	const obsidianRefs = getObsidianLinkReference(tokens);

	return {
		location: {path: page.file.path, position: item.position,},
		tokens: tokens,
		relatedObsidianRefs: obsidianRefs
	};
}

export function createSubtree(graph: DirectedGraphOfNotes, page: DvPage, item: DvList): string {
	const attributes = createItemNodeAttributes(page, item);
	addNode(graph, item.text, attributes)
	if (attributes.relatedObsidianRefs.length > 0) {
		for (const ref of attributes.relatedObsidianRefs) {
			if (ref.toLowerCase() == item.text.toLowerCase()) { // don't add self-references
				continue
			}

			addNode(graph, ref, {...attributes, ...{tokens: parseMarkdown(ref, {})}})
			addEdge(graph, ref, item.text, {
				mtime: page.file.mtime.ts,
				type: "related"
			})
		}

		return attributes.relatedObsidianRefs[0]
	}

	return item.text
}

export function indexSinglePage(page: DvPage, graph: DirectedGraphOfNotes) {
	const pageRef = "[[" + page.file.name + "]]";
	addNode(graph, pageRef, createPageNodeAttribute(page))

	for (const item of page.file.lists.values) {
		if (shouldSkip(item)) continue

		const treeNode = createSubtree(graph, page, item)

		if (!item.parent) {
			addEdge(graph, pageRef, treeNode, {
				mtime: page.file.mtime.ts,
				type: "parent"
			})
		}

		for (const child of item.children) {
			if (shouldSkip(child)) continue

			const childNode = createSubtree(graph, page, child)
			addEdge(graph, treeNode, childNode, {
				mtime: page.file.mtime.ts,
				type: "parent"
			})
		}
	}
}

export function indexTree(): Index | undefined {
	const dv = getAPI(this.app);

	if (dv == undefined) {
		new Notice("Dataview not enabled")
		return
	}

	const pages = dv.pages("")

	const graph = new Graph<NodeAttributes, EdgeAttributes, GraphAttributes>({allowSelfLoops: false});
	const idx: Index = {graph: graph}

	for (const dvp of pages) {
		const page = dvp as DvPage;
		indexSinglePage(page, graph);

		// for testing fixtures
		if (page.file.name == "ImportantProjects") {
			console.log("ImportantProjects", page)
		}
	}

	return idx;
}


