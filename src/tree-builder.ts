import Graph from "graphology";
import {Notice} from "obsidian";
import {getAPI, DataviewAPI} from "obsidian-dataview";
import {parseMarkdown} from "./parser";
import {Token} from "markdown-it";


export type NodeAttributes = {
	fullMarkdownText: string
	location: Location
	parsed: ParseResult
	tokens: Token[]
}

export type ParseResult = {
	url?: string
	page?: string
	mdUrl?: {
		text: string,
		url: string
	}
}

export type EdgeAttributes = {
	mtime: number;
}

export type GraphAttributes = {
	name?: string;
}

export type Index = {
	graph: Graph<NodeAttributes, EdgeAttributes, GraphAttributes>,
}

export type Location = {
	path: string,
	line: number
}

export type DvList = {
	link: { path: string },
	text: string,
	line: number,
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

function addNode(graph: Graph, name: string, attrs: NodeAttributes) {
	if (!graph.hasNode(name)) {
		graph.addNode(name, attrs)
	}
}

function addEdge(graph: Graph, from: string, to: string, attrs: EdgeAttributes) {
	if (!graph.hasEdge(from, to)) {
		graph.addDirectedEdge(from, to, attrs)
	}
}

function parseLine(markdown: string): ParseResult {
	return {
		page: extractFromPageName(markdown),
		url: extractUrlFromMarkdown(markdown),
		mdUrl: markdownUrlTextAndAddress(markdown)
	}
}

function markdownUrlTextAndAddress(markdown: string) {
	const match = markdown.match(/\[([^\]]+)\]\(([^)]+)\)/);
	if (match) {
		return {
			text: match[1],
			url: match[2]
		}
	}
}

// return pageName from "[[pageName]] followup" using regex
function extractFromPageName(pageName: string) {
	return pageName.match(/\[\[(.*)\]\]/)?.[1]
}

function extractHttpUrlFromMarkdown(markdown: string) {
	return markdown.match(/http[^)]+/)?.[0]
}

function extractUrlFromMarkdown(markdown: string) {
	return markdown.match(/\(([^)]+)\)/)?.[1] || extractHttpUrlFromMarkdown(markdown)
}

function shouldNotRender(item: DvList) {
	return !item.text.startsWith("[")
		&& !item.text.startsWith('!')
		&& !item.text.contains('#')
		&& !item.text.contains('http');
}

export function indexTree(): Index | undefined {
	const dv = getAPI(this.app);

	if (dv == undefined) {
		new Notice("Dataview not enabled")
		return
	}

	const pages = dv.pages("")
		// .where(p => p.file.name == "My Teams")

	const graph = new Graph<NodeAttributes, EdgeAttributes, GraphAttributes>();
	const idx: Index = {graph: graph}

	for (const dvp of pages) {
		const page = dvp as DvPage
		const pageRef = "[[" + page.file.name + "]]";
		addNode(graph, pageRef.toLowerCase(), {
			fullMarkdownText: pageRef,
			parsed: { page: page.file.name },
			location: {
				path: page.file.path,
				line: 0
			},
			tokens: []
		})

		for (const item of page.file.lists.values) {
			if (shouldNotRender(item)) continue

			addNode(graph, item.text.toLowerCase(), {
				fullMarkdownText: item.text,
				location: {
					path: page.file.path,
					line: item.line
				},
				parsed: parseLine(item.text),
				tokens: parseMarkdown(item.text, {})
			})

			addEdge(graph, pageRef.toLowerCase(), item.text.toLowerCase(), {mtime: page.file.mtime.ts})

			for (const child of item.children) {
				if (shouldNotRender(child)) continue

				addNode(graph, child.text.toLowerCase(), {
					fullMarkdownText: child.text,
					location: { path: page.file.path, line: child.line,},
					parsed: parseLine(child.text),
					tokens: parseMarkdown(item.text, {})
				})
				addEdge(graph, item.text.toLowerCase(), child.text.toLowerCase(), {mtime: page.file.mtime.ts})
			}
		}
	}

	console.log(idx)

	return idx
}


