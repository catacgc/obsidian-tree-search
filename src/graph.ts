import Graph from "graphology";
import {Token} from "markdown-it";
import {DvList, DvPage} from "./tree-builder";
import {parseMarkdown} from "./parser";
import {searchIndex} from "./search";

export type NodeAttributes = {
	location: Location
	tokens: Token[]
	tags: string[],
	aliases: string[],
	searchKey: string,
	nodeType: "page" | "text" | "task" | "completed-task" | "virtual-page" | "header"
}

export const EMPTY_NODE: NodeAttributes = {
	location: {
		path: "",
		position: {
			start: {line: 0, ch: 0},
			end: {line: 0, ch: 0},
		},
	},
	tokens: [],
	tags: [],
	aliases: [],
	searchKey: "",
	nodeType: "text"
}

export type EdgeAttributes = {
	mtime: number;
	type: "parent" | "related",
	location: NodeAttributes['location']
}

export type GraphAttributes = {
	name?: string;
}

export type DirectedGraphOfNotes = Graph<NodeAttributes, EdgeAttributes, GraphAttributes>

export type Location = {
	path: string,
	position: {
		start: {
			line: number,
			ch: number
		},
		end: {
			line: number,
			ch: number
		}
	}
}

type CreatedNodes = {
	textLine: string,
	header?: string,
	virtualReferences: ObsidianRef[],
	alias?: string,
	attributes: NodeAttributes
}

type ObsidianRef = {
	pageTarget: string,
	alias?: string,
	headerKey?: string,
	headerName?: string,
	source: string
}

export class NotesGraph {
	graph: Graph<NodeAttributes, EdgeAttributes, GraphAttributes>;

	constructor() {
		this.graph = new Graph<NodeAttributes, EdgeAttributes, GraphAttributes>()
	}

	addPageNode(page: DvPage, parentRelation: string): string {
		const pageRef = "[[" + page.file.name + "]]"

		if (this.graph.hasNode(pageRef.toLowerCase())) {
			this.removeExistingPageEdges(page)
		}

		const pageAttribute = this.createPageNodeAttribute(page);
		this.addNode(pageRef, pageAttribute)

		let parents = page.file.frontmatter[parentRelation] || [];
		if (typeof (parents) == "string") {
			parents = [parents]
		}

		for (const parent of parents) {
			this.createParentFromRelation(parent, pageAttribute, pageRef, page);
		}

		return pageRef
	}

	// handles references like [[parent]] , [[parent#header]] , [[parent|alias]]
	private createParentFromRelation(parent: string, pageAttribute: NodeAttributes, pageRef: string, page: DvPage) {
		const attrs = this.createVirtualPageNodeAttribute(parent, pageAttribute.location);
		const refs = this.getObsidianLinkReference(attrs.tokens)

		// cannot add inexisting refs as parents
		if (refs.length == 0) {
			return
		}

		const ref = refs[0]

		if (ref.headerKey) {
			this.addNode(ref.pageTarget, attrs)
			this.addNode(ref.headerKey, attrs)
			this.addChild(ref.pageTarget, ref.headerKey, page.file.mtime.ts, pageAttribute.location)
			this.addChild(ref.headerKey, pageRef, page.file.mtime.ts, pageAttribute.location)
		} else {
			this.addNode(ref.pageTarget, attrs)
			this.addChild(ref.pageTarget, pageRef, page.file.mtime.ts, pageAttribute.location)
		}
	}

	addItemNode(page: DvPage, item: DvList) {
		this.addNode(item.text, this.createItemNodeAttributes(page, item))
	}

	addChild(parent: string, child: string, mtime: number, location: NodeAttributes['location']) {
		this.addEdge(parent, child, {
			mtime: mtime,
			type: "parent",
			location: location
		})
	}

	createHeaderNode(page: string, header: string, location: NodeAttributes['location']): NodeAttributes {
		const tokens = [...parseMarkdown(`${page} > ${header}`, {})];

		return {
			location: location,
			tokens: tokens,
			tags: [],
			aliases: [],
			searchKey: header.toLowerCase(),
			nodeType: "header"
		};
	}

	private pruneDanglingNodes(node: string) {
		const attributes = this.graph.getNodeAttributes(node)
		if (this.graph.degree(node) == 0 && attributes.nodeType != "page") {
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
	 * TODO: add some tests
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

	/**
	 * examples:
	 *  - textLine (with #header) -> create "page#header" and "textLine"
	 *  - text line with [[ref]] [[ref2]] -> create "text line with [[ref]]", "[[ref]]", "[[ref2]]"
	 *  - [[Page|Alias]] -> create "[[page]]" and "[[page|alias]]"
	 *  - [[Page#header]] -> create "[[page]]" and "page#header"
	 *  - [ ] task -> create "task" with nodeType "task"
	 */
	createNodes(page: DvPage, item: DvList): CreatedNodes {
		const attributes = this.createItemNodeAttributes(page, item);
		this.addNode(item.text, attributes)

		let headerKey = ""
		// create header nodes
		if (!item.parent && item.section.subpath) {
			const trimmedHeaderName = item.section.subpath.replace(/#/g, " ").trim();
			const header = this.createHeaderNode(page.file.name, trimmedHeaderName, attributes.location)
			headerKey = page.file.name + "#" + trimmedHeaderName
			this.addNode(page.file.name + "#" + trimmedHeaderName, header)
		}

		// create refs
		const obsidianLinkReference = this.getObsidianLinkReference(attributes.tokens);

		this.createRefsNodes(obsidianLinkReference, attributes);

		return {
			textLine: item.text,
			header: headerKey,
			virtualReferences: obsidianLinkReference,
			alias: item.section.subpath,
			attributes: attributes
		}
	}

	private createRefsNodes(obsidianLinkReference: ObsidianRef[], attributes: NodeAttributes) {
		for (const ref of obsidianLinkReference) {
			const virtualPage = this.createVirtualPageNodeAttribute(ref.pageTarget, attributes.location)
			this.addNode(ref.pageTarget, virtualPage)

			if (ref.headerKey && ref.headerName) {
				const header = this.createHeaderNode(ref.pageTarget, ref.headerName, attributes.location)
				this.addNode(ref.headerKey, header)
			}
		}
	}

	/**
	 * if this has a header then create /parent -> #header -> subtree(line)
	 * if this has no parent then create /parent -> subtree(line)
	 * if this has a reference to some other page [[ref]] then create
	 * 		/parent -> subtree(line)
	 * 		[[ref]] -> subtree(line)
	 */
	createSubtree(parentNode: string, page: DvPage, item: DvList): string {
		const created = this.createNodes(page, item)

		// create a header node
		if (created.header) {
			this.addChild(parentNode, created.header, page.file.mtime.ts, created.attributes.location)
			parentNode = created.header
		}

		// if the line is the actual ref of the format [[ref]] , [[ref|alias]] or [[ref#header]]
		if (created.virtualReferences.length == 1) {
			const ref = created.virtualReferences[0]
			if (ref.source.toLowerCase() == created.textLine.toLowerCase()) {
				this.addChild(parentNode, ref.pageTarget, page.file.mtime.ts, created.attributes.location)
				if (ref.headerKey) {
					this.addChild(ref.pageTarget, ref.headerKey, page.file.mtime.ts, created.attributes.location)
				}
				return ref.headerKey || ref.pageTarget
			}
		}

		for (const ref of created.virtualReferences) {

			if (!ref.headerKey) {
				this.addChild(ref.pageTarget, created.textLine, page.file.mtime.ts, created.attributes.location)
			} else {
				this.addChild(ref.pageTarget, ref.headerKey, page.file.mtime.ts, created.attributes.location)
				this.addChild(ref.headerKey, created.textLine, page.file.mtime.ts, created.attributes.location)
			}
		}

		this.addChild(parentNode, created.textLine, page.file.mtime.ts, created.attributes.location)

		return created.textLine
	}

	private addNode(key: string, attrs: NodeAttributes) {
		const nodeKey = key.toLowerCase();
		if (!this.graph.hasNode(nodeKey)) {
			this.graph.addNode(nodeKey, attrs)
		} else if (attrs.aliases.length > 0) {
			// const existing = this.graph.getNodeAttributes(nodeKey)
			this.graph.mergeNodeAttributes(nodeKey, attrs)
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

	private createItemNodeAttributes(page: DvPage, item: DvList): NodeAttributes {
		const tokens = [...parseMarkdown(item.text, {})];

		return {
			location: {path: page.file.path, position: {
					start: {line: item.position.start.line, ch: item.position.start.col},
					end: {line: item.position.end.line, ch: item.position.end.col}}},
			tokens: tokens,
			tags: item.tags,
			aliases: [],
			searchKey: item.text.toLowerCase(),
			nodeType: item.task ? (item.completed ? "completed-task" : "task") : "text"
		};
	}

	private getObsidianLinkReference(tokens: Token[]): ObsidianRef[] {
		const refs: ObsidianRef[] = []

		const obisidianLinks = tokens.flatMap(children => children.children).filter(it => it?.type == 'obsidian_link');
		for (const token of obisidianLinks) {
			const link = token?.content
			if (!link) continue

			const actualRef = `[[${link}]]`

			if (link.includes('#'))  {
				const parts = link.split('#')
				refs.push({source: actualRef, pageTarget: '[[' + parts[0] + ']]', headerName: parts[1], headerKey: parts[0] + '#' + parts[1]})
				continue
			}

			const parts = link.split("|")
			if (parts.length == 1) {
				refs.push({source: actualRef, pageTarget: '[[' + parts[0] + ']]'})
			} else {
				refs.push({source: actualRef, pageTarget: '[[' + parts[0] + ']]', alias: parts[1]})
			}
		}

		return refs
	}

	private createVirtualPageNodeAttribute(pageReference: string, location: NodeAttributes['location']): NodeAttributes {
		const tokens = [...parseMarkdown(pageReference, {})];
		return {
			location: location,
			tokens: tokens,
			tags: [],
			aliases: [],
			searchKey: pageReference.toLowerCase(),
			nodeType: "virtual-page"
		}
	}

	private createPageNodeAttribute(page: DvPage): NodeAttributes {
		const tokens = [...parseMarkdown(`[[${page.file.name}]]`, {})];
		return {
			location: {
				path: page.file.path,
				position: {start: {line: 0, ch: 0}, end: {line: 0, ch: 0}}
			},
			tokens: tokens,
			tags: page.file.tags,
			aliases: page.file.aliases.values,
			searchKey: `${page.file.name} ${page.file.aliases.values.join(" ")}`.toLowerCase(),
			nodeType: "page"
		}
	}
}
