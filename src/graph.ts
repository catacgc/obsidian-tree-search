import Graph from "graphology";
import {Token} from "markdown-it";
import {DvList, DvPage} from "./tree-builder";
import {parseTokens} from "./parser";
import { HeadingCache } from "obsidian";

export type BaseNode = {
	searchKey: string,
	location: Location,
}

export type PageNode = BaseNode & {
	nodeType: "page",
	isReference: boolean,
	page: string,
	aliases: string[],
	tags: string[],
}

export type TextToken = {
	tokenType: "text",
	text: string,
	decoration: "italic" | "bold" | "underline" | "strikethrough" | "code" | "none",
}

export type ObsidianLinkToken = {
	tokenType: "obsidian_link",
	source: string,
	pageTarget: string,
	alias?: string,
	headerName?: string,
}

export type LinkToken = {
	tokenType: "link",
	href: string,
	content?: string,
}

export type ImageToken = {
	tokenType: "image",
	src: string,
	alt?: string,
}

export type ParsedTextToken = TextToken | ObsidianLinkToken | LinkToken | ImageToken

export type TextNode = BaseNode & {
	nodeType: "text",
	// tokens: Token[],
	parsedTokens: ParsedTextToken[],
	tags: string[],
	isTask: boolean,
	isCompleted: boolean,
}

export type HeaderNode = BaseNode & {
	nodeType: "header",
	page: string,
	header: string,
	isReference: boolean
}

export type ParsedNode = BaseNode & (PageNode | TextNode | HeaderNode)

function getKey(node: ParsedNode): string {
	switch(node.nodeType) {
		case "page":
			return `[[${node.page.toLowerCase()}]]`
		case "header":
			return (node.page + "#" + node.header).toLowerCase()
		case "text":
			return node.searchKey
	}
}


export const EMPTY_NODE: ParsedNode = {
		nodeType: "text",
		// tokens: [],
		parsedTokens: [],
		tags: [],
		location: {
			path: "",
			position: {start: {line: 0, ch: 0}, end: {line: 0, ch: 0}},
		},
		isTask: false,
		isCompleted: false,
		searchKey: ""
	}

export type EdgeAttributes = {
	mtime: number;
	type: "parent" | "related",
	location: ParsedNode['location']
}

export type GraphAttributes = {
	name?: string;
}

export type DirectedGraphOfNotes = Graph<ParsedNode, EdgeAttributes, GraphAttributes>

export type Location = {
	path: string,
	position: {
		start: {line: number, ch: number},
		end: {line: number, ch: number}
	}
}

export class NotesGraph {
	graph: Graph<ParsedNode, EdgeAttributes, GraphAttributes>;

	constructor() {
		this.graph = new Graph<ParsedNode, EdgeAttributes, GraphAttributes>()
	}

	addPageNode(page: DvPage, parentRelation: string, isArchived: boolean = false): PageNode {
		// edit the existing page node, if it exists
		if (this.graph.hasNode(`[[${page.file.name.toLowerCase()}]]`)) {
			this.removeExistingPageEdges(page)
		}

		const pageNode = this.createPageNode(page);

		let parents = page.file.frontmatter[parentRelation] || [];
		if (typeof (parents) == "string") {
			parents = [parents]
		}

		for (const parent of parents) {
			this.createParentFromRelation(parent, pageNode);
		}

        !isArchived && this.createHeadersNodes(pageNode, page)

		return pageNode
	}

	// handles references like [[parent]] , [[parent#header]] , [[parent|alias]]
	private createParentFromRelation(parent: string, page: ParsedNode) {
		const refs = this.getRefsFromString(parent)
		// cannot add inexisting refs as parents
		if (refs.length == 0) {
			return
		}

		const ref = this.createVirtualPage(refs[0], page.location)
		this.addChild(ref, page, page.location, 0)
	}

	addChild(parent: ParsedNode, child: ParsedNode, location: BaseNode['location'], mtime: number) {
		this.addEdge(getKey(parent), getKey(child), {
			mtime: mtime,
			type: "parent",
			location: location
		})
	}

	private createHeaderNode(page: string, heading: string, location: BaseNode['location'], isReference: boolean = true): HeaderNode {
		const node: HeaderNode = {	
			page: page,
			header: heading,
			isReference: isReference,
			nodeType: "header",
			location: location,
			searchKey: `${page}#${heading}`.toLowerCase()
		}

		this.addOrUpdateNode(node)

		return node
	}

	private pruneDanglingNodes(node: string) {
		const attributes = this.graph.getNodeAttributes(node)
		if (this.graph.degree(node) == 0) {
			if (attributes.nodeType == "page" && !attributes.isReference) {
				return // do not remove real pages from the graph, even if nothing points to them
			}

			const outgoingRefs = this.graph.outNeighbors(node)
			this.graph.dropNode(node)
			for (const ref of outgoingRefs) {
				this.pruneDanglingNodes(ref)
			}
		}
	}

	/**
	 * Gets rid of all edges that where created on this page and that need to be recreated after this
	 * If a not was created in this page and no other edge points to it, then it will be removed
	 */
	private removeExistingPageEdges(page: DvPage) {
		const ref = "[[" + page.file.name.toLowerCase() + "]]"
		const edgesCreatedInFile = this.graph.filterDirectedEdges((_, edge) => edge.location.path == page.file.path);

		// nodes in this file
		const nodesFromFile = edgesCreatedInFile
			.map(it => this.graph.extremities(it))
			.flat()
			.filter(it => it != ref)

		// delete edges
		edgesCreatedInFile
			.forEach(edge => {
				this.graph.dropEdge(edge)
			})

		// delete nodes if there's no edge pointing to them
		new Set(nodesFromFile).forEach(node => {
			// console.log("remove page node", page.file.path, node)
			this.pruneDanglingNodes(node)
		})
	}

    private createHeadersNodes(pageRef: PageNode, page: DvPage) {
		function findParent(headerIndex: number): HeadingCache | null {
			const header = page.headers[headerIndex]
			if (header.level == 1) {
				return null
			}
	
			for (let i = headerIndex - 1; i >= 0; i--) {
				const candidate = page.headers[i]
				if (candidate.level <= header.level - 1) {
					return candidate
				}
			}
	
			return null
		}

		const createNode = (header: HeadingCache): HeaderNode => {
			const position = {start: {line: header.position.start.line, ch: header.position.start.col},
                end: {line: header.position.end.line, ch: header.position.end.col}};
            const location = {
                path: page.file.path,
                position: position
            };

			return this.createHeaderNode(page.file.name, header.heading, location, false)
		}

        for (let i = 0; i < page.headers.length; i++) {
			const header = createNode(page.headers[i])
			const parent = findParent(i)

			if (parent) {
				const parentNode = createNode(parent)
				this.addChild(parentNode, header, header.location, page.file.mtime.ts)
			} else {
				this.addChild(pageRef, header, header.location, page.file.mtime.ts)
			}
        }
    }

	private createRefsNodes(obsidianLinkReference: ObsidianLinkToken[], textNode: TextNode): ParsedNode[] {
		return obsidianLinkReference.map(ref => this.createVirtualPage(ref, textNode.location))
	}

	private getClosestHeader(headers: HeadingCache[], line: number): HeadingCache | null {
		for (let i = headers.length - 1; i >= 0; i--) {
			if (headers[i].position.start.line <= line) {
				return headers[i]
			}
		}

		return null
	}

	/**
	 * examples:
	 *  - textLine (with #header) -> create "page#header" and "textLine"
	 *  - text line with [[ref]] [[ref2]] -> create "text line with [[ref]]", "[[ref]]", "[[ref2]]"
	 *  - [[Page|Alias]] -> create "[[page]]" and "[[page|alias]]"
	 *  - [[Page#header]] -> create "[[page]]" and "page#header"
	 *  - [ ] task -> create "task" with nodeType "task"
	 */
	createTreeFromTextLine(parentNode: ParsedNode, page: DvPage, item: DvList): ParsedNode {
		const createdNode = this.createNodeFromText(page, item);

		const closestParentHeader = this.getClosestHeader(page.headers, item.position.start.line)

		// if this item does not have a parent and it is in a subsection, then add it as child of the header node
		if (!item.parent && closestParentHeader) {
			const header = this.createHeaderNode(page.file.name, closestParentHeader.heading, createdNode.location, false)
			this.addChild(header, createdNode, createdNode.location, 0)
			// this.addChild(parentNode, header, createdNode.location, 0)
		} else {
			this.addChild(parentNode, createdNode, createdNode.location, page.file.mtime.ts)
		}
		
		return createdNode
	}

	private mergePageNode(node1: PageNode, node2: PageNode): PageNode {
		node1.aliases = [...new Set([...node1.aliases, ...node2.aliases])]
		node1.isReference = node1.isReference && node2.isReference
		node1.searchKey = (node1.page + "|" + node1.aliases.join(" ")).toLowerCase()
		
		return node1
	}

	private mergeHeaderNode(node1: HeaderNode, node2: HeaderNode): HeaderNode {
		node1.isReference = node1.isReference && node2.isReference
		return node1
	}
	
	private addOrUpdateNode(node: ParsedNode) {
		const nodeKey = getKey(node);
		if (!this.graph.hasNode(nodeKey)) {
			this.graph.addNode(nodeKey, node)
		} else if (node.nodeType == "page") {
			this.graph.replaceNodeAttributes(nodeKey, this.mergePageNode(this.graph.getNodeAttributes(nodeKey) as PageNode, node))
		} else if (node.nodeType == "header") {
			this.graph.replaceNodeAttributes(nodeKey, this.mergeHeaderNode(this.graph.getNodeAttributes(nodeKey) as HeaderNode, node))
		}
	}

	private addEdge(from: string, to: string, attrs: EdgeAttributes) {
		const sourceKey = from.toLowerCase();
		const targetKey = to.toLowerCase();
		if (sourceKey == targetKey) {
			return
		}
		if (!this.graph.hasEdge(sourceKey, targetKey)) {
			this.graph.addDirectedEdge(sourceKey, targetKey, attrs)
		}
	}

	private createNodeFromText(page: DvPage, item: DvList): TextNode | PageNode | HeaderNode {
		const parsed = parseTokens(item.text)
		const location = {path: page.file.path, position: {
			start: {line: item.position.start.line, ch: item.position.start.col},
			end: {line: item.position.end.line, ch: item.position.end.col}}}

		const obsidianLinkReference: ObsidianLinkToken[] = this.getObsidianLinkReference(parsed);

		// if this is just a page reference, then skip the text node
		if (obsidianLinkReference.length == 1 && obsidianLinkReference[0].source == item.text) {
			return this.createVirtualPage(obsidianLinkReference[0], location)
		}

		let textNode: TextNode = {
			location: location,
			searchKey: item.text.toLowerCase(),
			parsedTokens: parsed,
			nodeType: "text",
			// tokens: tokens,
			tags: item.tags,
			isTask: item.task,
			isCompleted: item.completed,
		}

		this.addOrUpdateNode(textNode)

		// make all reference nodes, parents of the text node
		const parentsFromRefs = this.createRefsNodes(obsidianLinkReference, textNode);
		parentsFromRefs.forEach(it => this.addChild(it, textNode, textNode.location, 0))

		return textNode;
	}

	/** This is very dump and probably needs the app context to get the actual reference */
	private resolveReference(ref: string): string {
		if (ref.includes("/")) {
			return ref.split("/")[1]
		}

		return ref
	}

	private getRefsFromString(pageReference: string): ObsidianLinkToken[] {
		return this.getObsidianLinkReference(parseTokens(pageReference))
	}

	private getObsidianLinkReference(tokens: ParsedTextToken[]): ObsidianLinkToken[] {

		return tokens
			.filter(it => it.tokenType == 'obsidian_link') as ObsidianLinkToken[]
	}

	private createHeader(pageReference: ObsidianLinkToken, location: BaseNode['location']): HeaderNode | null {
		if (pageReference.headerName) {
			return this.createHeaderNode(pageReference.pageTarget, pageReference.headerName, location, true)
		}

		return null
	}

	/**
	 * [[ParsedNode|Alias#Header]]
	 */
	private createVirtualPage(pageReference: ObsidianLinkToken, location: BaseNode['location']): PageNode | HeaderNode {
		const page: PageNode = {
			nodeType: "page",
			isReference: true,
			page: pageReference.pageTarget,
			aliases: pageReference.alias ? [pageReference.alias] : [],
			tags: [],
			location: location,
			searchKey: pageReference.pageTarget.toLowerCase(),
		}

		this.addOrUpdateNode(page)

		const header = this.createHeader(pageReference, location)
		if (header) {
			this.addOrUpdateNode(header)
			this.addChild(page, header, location, 0)
			return header
		}

		return page
	}

	private createPageNode(page: DvPage): PageNode {
		const node: PageNode = {
			nodeType: "page",
			isReference: false,
			page: page.file.name,
			aliases: page.file.aliases.values,
			tags: page.file.tags,
			location: {
				path: page.file.path,
				position: {start: {line: 0, ch: 0}, end: {line: 0, ch: 0}}
			},
			searchKey: `${page.file.name}|${page.file.aliases.values.join(" ")}`.toLowerCase(),
		}

		this.addOrUpdateNode(node)

		return node
	}
}
