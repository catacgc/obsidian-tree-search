import Graph, {MultiDirectedGraph} from "graphology";
import {DvList, DvPage, isOnlyText} from "./indexing/markdown";
import {parseTokens} from "./indexing/parser";
import {HeadingCache, TFile, TFolder} from "obsidian";
import {containsEmoji} from "./search/query";




function extractDateFromString(string: string): Date | null {
    const dateRegex = /(\d{4}-\d{2}-\d{2})/;
    const match = string.match(dateRegex);
    if (match) {
        const dateStr = match[1];
        const date = new Date(dateStr);
        // Validate the date is valid
        if (!isNaN(date.getTime())) {
            return date;
        }
    }
    return null;
}

/**
 * Calculate age in days from a timestamp or date
 * @param timestamp Timestamp in milliseconds or Date object
 * @returns Number of days since the date
 */
function calculateAgeDays(timestamp: number | Date): number {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const now = new Date();
    const diffTime = now.getTime() - date.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Calculate age in days from modification time and filename
 * @param modifiedTime Optional modification time (timestamp or Date)
 * @param filename Optional filename for date extraction
 * @returns Number of days since the date
 */
function getAgeDays(modifiedTime?: number | Date, filename?: string): number {
    let dateToUse: Date | null = null;

    // First try to extract date from filename if provided
    if (filename) {
        dateToUse = extractDateFromString(filename);
    }

    // If no date from filename and we have modifiedTime, use that
    if (!dateToUse && modifiedTime !== undefined) {
        dateToUse = modifiedTime instanceof Date ? modifiedTime : new Date(modifiedTime);
    }

    if (dateToUse) {
        return calculateAgeDays(dateToUse);
    }

    return 0; // Default to 0 if no date available
}

/**
 * Calculate boost value for a node based on its type and content
 * @param nodeType Type of the node
 * @param searchKey Search key to check for emojis
 * @param ageDays Age in days (0 or positive number)
 * @returns Calculated boost value
 */
function calculateBoost(
    nodeType: "page" | "header" | "folder" | "attachment" | "folderNote" | "text" | "month" | "pointer",
    searchKey: string,
    ageDays: number = 0
): number {
    const BOOST : Record<ParsedNode['nodeType'], number> = {
        page: 6,
        folder: 5,
        folderNote: 5,
        header: 4,
        attachment: 3,
        month: 2,
        pointer: 1,
        text: 1
    }

    const ageBoost = 1000 - ageDays; // fresh is better
    const typeBoost = (10 + BOOST[nodeType]) * 10000
    const emojiBoost = containsEmoji(searchKey) ? 1000 : 0;

    return ageBoost + typeBoost + emojiBoost;
}
export type BaseNode = {
	searchKey: string,
	location: Location,
    boost?: number,
    ageDays: number
}

export type FolderNode = BaseNode & {
	nodeType: "folder",
	path: string,
	name: string,
	folderNote: string
}

export type PointerNode = BaseNode & {
	nodeType: "pointer",
	target: string // graph node key
}

export type FolderNote = BaseNode & {
    nodeType: "folderNote",
    folder: FolderNode
    page: PageNode
}

export type AttachmentNode = BaseNode & {
    nodeType: 'attachment',
    name: string
    extension: string
    aliases: string[]
}

export type PageNode = BaseNode & {
	nodeType: "page",
	isReference: boolean,
	page: string,
	aliases: string[],
	tags: string[]
}

export type TextNode = BaseNode & {
	nodeType: "text",
	parsedTokens: ParsedTextToken[],
	tags: string[],
	isTask: boolean,
	isCompleted: boolean,
}

export type HeaderNode = BaseNode & {
	nodeType: "header",
	page: string,
	header: string,
	indent: number
}

export type MonthNode = BaseNode & {
	nodeType: "month",
	month: number,
	monthLiteral: string,
	year: number,
}

export type ParsedNode = BaseNode & (PageNode | TextNode | HeaderNode | MonthNode | FolderNode | AttachmentNode | FolderNote | PointerNode)

export type TextToken = {
	tokenType: "text",
	text: string,
	decoration: "italic" | "bold" | "underline" | "strikethrough" | "code" | "none",
}

export type TextTokenWithLocationLink = TextToken & {
	location: Location,
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

export type ParsedTextToken = TextToken | ObsidianLinkToken | LinkToken | ImageToken | TextTokenWithLocationLink

function getKey(node: ParsedNode): string {
	switch(node.nodeType) {
		case "page":
			return `[[${node.page.toLowerCase().replace(/\.canvas$/, '')}]]`
        case "folderNote":
			return `folderNote:${node.folder.name.toLowerCase()}`
        case "pointer":
			return `pointer:${node.target}`
		case "header":
			return (node.page + "#" + node.header).toLowerCase()
		case "text":
			return node.searchKey
		case "month":
			return `${node.year}-${node.month}`
		case "folder":
			return node.path.toLowerCase()
        case "attachment":
            return node.name.toLowerCase()
	}
}

export const EMPTY_NODE: ParsedNode = {
		nodeType: "text",
		parsedTokens: [],
		tags: [],
		location: {
			path: "",
			position: {start: {line: 0, ch: 0}, end: {line: 0, ch: 0}},
		},
		isTask: false,
		isCompleted: false,
		searchKey: "",
		boost: calculateBoost("text", "", 0),
		ageDays: 0
	}

export type EdgeAttributes = {
	mtime: number;
	type: "parent" | "related" | "month",
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
	},
	canvasNode?: string
}

class PointersGraph extends MultiDirectedGraph<{}, {key: string}, {name: string}> {
    constructor() {
        super()
    }

    private getDuplicateKey(parsedNode: ParsedNode) {
        switch (parsedNode.nodeType) {
            case "page":
                return parsedNode.page
            case "header":
                return parsedNode.page + "#" + parsedNode.header
            case "text":
                return null
            case "month":
                return parsedNode.monthLiteral
            case "folder":
                return parsedNode.name
            case "attachment":
                return parsedNode.name
            case "folderNote":
                return parsedNode.folder.name
            case "pointer":
                return parsedNode.target
        }
    }

    addParsedNode(node: ParsedNode) {
        const duplicateKey = this.getDuplicateKey(node)
        const targetKey = getKey(node)

        this.addNode(duplicateKey)
        this.addNode(targetKey)
        this.addEdge(duplicateKey, targetKey, {key: targetKey})
    }

    with<A extends ParsedNode, B extends ParsedNode>(parsedNode: ParsedNode, predicate: (a: A, b: B) => void ) {
        
    }

    upgradeVirtualPageToPage(node: ParsedNode, graph: NotesGraph) {
        const duplicateKey = this.getDuplicateKey(node)
        const targetKey = getKey(node)

        if (duplicateKey == targetKey) {
            return
        }

        if (this.hasNode(duplicateKey)) {
            const edges = this.outEdges(duplicateKey)
            for (const edge of edges) {
                this.dropEdge(edge)
            }
        }
    }

    upgradeFolderToFolderNote(node: ParsedNode, graph: NotesGraph) {
        const duplicateKey = this.getDuplicateKey(node)
        const targetKey = getKey(node)

        if (duplicateKey == targetKey) {
            return
        }

        if (this.hasNode(duplicateKey)) {
            const edges = this.outEdges(duplicateKey)
            for (const edge of edges) {
                this.dropEdge(edge)
            }
        }
    }

}

export class NotesGraph {
	graph: Graph<ParsedNode, EdgeAttributes, GraphAttributes>;
    pointers: PointersGraph;

	constructor() {
		this.graph = new Graph<ParsedNode, EdgeAttributes, GraphAttributes>()
        this.pointers = new PointersGraph()
	}

	addPageNode(page: DvPage, parentRelation: string, isArchived: boolean = false): PageNode {
		// edit the existing page node, if it exists

		const pageNode = this.createPageNode(page);

		let parents = page.file.frontmatter[parentRelation] || [];
		if (typeof (parents) == "string") {
			parents = [parents]
		}

		for (const parent of parents) {
			this.createParentFromRelation(parent, pageNode, page.file.mtime.ts);
		}

        !isArchived && this.createHeadersNodes(pageNode, page)

		return pageNode
	}

	// handles references like [[parent]] , [[parent#header]] , [[parent|alias]]
	private createParentFromRelation(parent: string, page: ParsedNode, mtime: number) {
		const refs = this.getRefsFromString(parent)
		// cannot add inexisting refs as parents
		if (refs.length == 0) {
			return
		}

		const ref = this.createVirtualPage(refs[0], page.location, getAgeDays(mtime))
		this.addChild(ref, page, page.location, mtime)
	}

	addChild(parent: ParsedNode, child: ParsedNode, location: BaseNode['location'], mtime: number) {
		this.addEdge(getKey(parent), getKey(child), {
			mtime: mtime,
			type: "parent",
			location: location
		})
	}

	createHeaderNode(page: string, heading: string, location: BaseNode['location'], indent: number = -1, modifiedTime?: number, filename?: string): HeaderNode {
		const searchKey = `${page}#${heading}`.toLowerCase();
		const ageDays = getAgeDays(modifiedTime, filename + heading);
		const node: HeaderNode = {
			page: page,
			header: heading,
			indent: indent,
			nodeType: "header",
			location: location,
			searchKey: searchKey,
			boost: calculateBoost("header", searchKey, ageDays),
			ageDays: ageDays
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
	removeExistingPageEdges(page: PageNode) {
		const ref = getKey(page)
		const edgeLocationPath = page.location.path

		if (!this.graph.hasNode(ref)) {
			return
		}

		const edgesCreatedInFile = this.graph.filterDirectedEdges((_, edge) => edge.location.path == edgeLocationPath);

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
			const position = toLocation(header.position);
            const location = {
                path: page.file.path,
                position: position
            };

			return this.createHeaderNode(page.file.name, header.heading, location, header.level, page.file.mtime.ts, page.file.name)
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

	createRefsNodes(obsidianLinkReference: ObsidianLinkToken[], textNode: TextNode, ageDays: number): ParsedNode[] {
		return obsidianLinkReference.map(ref => this.createVirtualPage(ref, textNode.location, ageDays))
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
			const header = this.createHeaderNode(page.file.name, closestParentHeader.heading, createdNode.location, -1, page.file.mtime.ts, page.file.name)
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
		// Keep the higher boost value when merging
		node1.boost = Math.max(node1.boost || 0, node2.boost || 0)

		return node1
	}

	private mergeHeaderNode(node1: HeaderNode, node2: HeaderNode): HeaderNode {
		node1.indent = node1.indent > node2.indent ? node1.indent : node2.indent
		// Keep the higher boost value when merging
		node1.boost = Math.max(node1.boost || 0, node2.boost || 0)
		return node1
	}
	
	addOrUpdateNode(node: ParsedNode) {
		const nodeKey = getKey(node);
		if (!this.graph.hasNode(nodeKey)) {
			this.graph.addNode(nodeKey, node)
		} else if (node.nodeType == "page") {
			this.graph.replaceNodeAttributes(nodeKey, this.mergePageNode(this.graph.getNodeAttributes(nodeKey) as PageNode, node))
		} else if (node.nodeType == "header") {
			this.graph.replaceNodeAttributes(nodeKey, this.mergeHeaderNode(this.graph.getNodeAttributes(nodeKey) as HeaderNode, node))
		}

		// if we have a page named identically to the folder, then we have a folder node
		if (node.nodeType == "folder" && !this.graph.hasNode(nodeKey)) {
			const folder = this.findFolderNote(node)
			console.log(folder)
		}

		if (node.nodeType == "page" && !this.graph.hasNode(nodeKey)) {
			const folder = this.findFolderForNote(node)
			console.log(folder)
		}
	}

	private findFolderForNote(page: PageNode) {
		const key = `${page.page}`.toLowerCase()
		const folders =  this.graph.filterNodes((it, attrs) => attrs.nodeType == "folder" && attrs.name.toLowerCase() == key)
		if (folders.length == 0) {
			return null
		} else if (folders.length > 1) {
			console.warn(`multiple folders found for ${page.page}`)
		}

		return this.graph.getNodeAttributes(folders[0]) as FolderNode
	}

	private findFolderNote(folder: FolderNode): PageNode | null {
		const folderName = folder.name.toLowerCase()

		// Look for exact page name match first
		const exactMatches = this.graph.filterNodes((nodeKey, attrs) =>
			attrs.nodeType === "page" && attrs.page.toLowerCase() === folderName
		)

		if (exactMatches.length > 0) {
			return this.graph.getNodeAttributes(exactMatches[0]) as PageNode
		}

		// If no exact match, look for pages that have the folder name in their aliases
		const aliasMatches = this.graph.filterNodes((nodeKey, attrs) => {
			if (attrs.nodeType !== "page") return false
			const aliases = (attrs as PageNode).aliases || []
			return aliases.some(alias => alias.toLowerCase() === folderName)
		})

		if (aliasMatches.length > 0) {
			return this.graph.getNodeAttributes(aliasMatches[0]) as PageNode
		}

		return null
	}

	// private createFolderNoteNode(folder: FolderNode, page: PageNode): FolderNote {
	// 	// Use folder name as the primary identifier for the FolderNote
	// 	const searchKey = folder.name.toLowerCase(); // Use folder name as primary search key
	// 	const folderNote: FolderNote = {
	// 		nodeType: "folderNote",
	// 		folder: folder,
	// 		page: page,
	// 		location: page.location,
	// 		searchKey: searchKey,
	// 		boost: calculateBoost("folderNote", searchKey),
    //         ageDays: 0
	// 	}
    //
	// 	const folderNoteKey = getKey(folderNote)
    //
	// 	// Check if FolderNote already exists
	// 	if (this.graph.hasNode(folderNoteKey)) {
	// 		return this.graph.getNodeAttributes(folderNoteKey) as FolderNote
	// 	}
    //
	// 	// Check if there's already a FolderNote for this folder (with different page)
	// 	const existingFolderNotes = this.graph.filterNodes((nodeKey, attrs) =>
	// 		attrs.nodeType === "folderNote" &&
	// 		(attrs as FolderNote).folder.name.toLowerCase() === folder.name.toLowerCase()
	// 	)
    //
	// 	if (existingFolderNotes.length > 0) {
	// 		// Return the existing FolderNote instead of creating a new one
	// 		console.warn(`FolderNote already exists for folder ${folder.name}`)
	// 		return this.graph.getNodeAttributes(existingFolderNotes[0]) as FolderNote
	// 	}
    //
	// 	// Add the node directly to avoid recursion in addOrUpdateNode
	// 	this.graph.addNode(folderNoteKey, folderNote)
	// 	return folderNote
	// }

	/**
	 * Create a pointer node that redirects to a target node
	 */
	// private createPointerNode(sourceNode: ParsedNode, targetNode: ParsedNode, customTargetKey?: string): PointerNode {
	// 	const targetKey = customTargetKey || getKey(targetNode)
	// 	const searchKey = sourceNode.searchKey;
	// 	const pointer: PointerNode = {
	// 		nodeType: "pointer",
	// 		target: targetKey,
	// 		location: sourceNode.location,
	// 		searchKey: searchKey,
    //         ageDays: 0,
	// 		boost: calculateBoost("pointer", searchKey) // Inherit boost from source node plus emoji boost if applicable,\
	// 	}
    //
	// 	// Replace the source node with a pointer
	// 	const sourceKey = getKey(sourceNode)
	// 	if (this.graph.hasNode(sourceKey)) {
	// 		this.graph.replaceNodeAttributes(sourceKey, pointer)
	// 	}
    //
	// 	return pointer
	// }

	/**
	 * Resolve a node to its final target if it's a pointer
	 */
	private resolvePointer(node: ParsedNode): ParsedNode {
		if (node.nodeType === "pointer") {
			const targetKey = node.target
			if (this.graph.hasNode(targetKey)) {
				const targetNode = this.graph.getNodeAttributes(targetKey)
				// Recursively resolve in case of chained pointers
				return this.resolvePointer(targetNode)
			}
		}
		return node
	}

	private addEdge(from: string, to: string, attrs: EdgeAttributes) {
		const sourceKey = from.toLowerCase();
		const targetKey = to.toLowerCase();

		if (sourceKey == targetKey) {
			return
		}

		// Ensure both nodes exist before adding edge
		if (!this.graph.hasNode(sourceKey) || !this.graph.hasNode(targetKey)) {
			console.warn(`Cannot add edge: missing node(s) ${sourceKey} -> ${targetKey}`)
			return
		}

		if (!this.graph.hasEdge(sourceKey, targetKey)) {
			this.graph.addDirectedEdge(sourceKey, targetKey, attrs)
		}
	}

	createFolderNode(folder: TFolder): ParsedNode {

		const location = {path: folder.path, position: {start: {line: 0, ch: 0}, end: {line: 0, ch: 0}}}

		const searchKey = `${folder.name || "(root)"}`.toLowerCase();
		const ageDays = getAgeDays(new Date(), folder.name); // Folders use current date
		const folderNode: FolderNode = {
			nodeType: "folder",
			path: folder.path,
            folderNote: `${folder.path}/${folder.name || "root"}.md`,
			name: folder.name,
			location: location,
			searchKey: searchKey,
			boost: calculateBoost("folder", searchKey, ageDays),
			ageDays: ageDays
		}

		this.addOrUpdateNode(folderNode)

		return folderNode;
	}

	private createNodeFromText(page: DvPage, item: DvList): TextNode | PageNode | HeaderNode {
		const parsed = parseTokens(item.text)
		const location = {path: page.file.path, position: toLocation(item.position)}

		const obsidianLinkReference: ObsidianLinkToken[] = this.getObsidianLinkReference(parsed);

        const searchKey = item.text.toLowerCase();
        const ageDays = getAgeDays(page.file.mtime.ts, searchKey);


		// if this is just a page reference, then skip the text node
		if (obsidianLinkReference.length == 1 && obsidianLinkReference[0].source == item.text) {
			return this.createVirtualPage(obsidianLinkReference[0], location, ageDays)
        }

		let textNode: TextNode = {
			location: location,
			searchKey: searchKey,
			parsedTokens: parsed,
			nodeType: "text",
			// tokens: tokens,
			tags: item.tags,
			isTask: item.task,
			isCompleted: item.completed,
			boost: calculateBoost("text", searchKey, ageDays),
			ageDays: ageDays
		}

		this.addOrUpdateNode(textNode)

		// make all reference nodes, parents of the text node
		const parentsFromRefs = this.createRefsNodes(obsidianLinkReference, textNode, ageDays);
		parentsFromRefs.forEach(it => this.addChild(it, textNode, textNode.location, page.file.mtime.ts))

		return textNode;
	}

	private getRefsFromString(pageReference: string): ObsidianLinkToken[] {
		return this.getObsidianLinkReference(parseTokens(pageReference))
	}

	getObsidianLinkReference(tokens: ParsedTextToken[]): ObsidianLinkToken[] {

		return tokens
			.filter(it => it.tokenType == 'obsidian_link') as ObsidianLinkToken[]
	}

	private createHeader(pageReference: ObsidianLinkToken, location: BaseNode['location']): HeaderNode | null {
		if (pageReference.headerName) {
			return this.createHeaderNode(pageReference.pageTarget, pageReference.headerName, location, -1)
		}

		return null
	}

	/**
	 * [[ParsedNode|Alias#Header]]
	 */
    createVirtualPage(pageReference: ObsidianLinkToken, location: BaseNode["location"], ageDays: number): PageNode | HeaderNode {
		const aliases = pageReference.alias ? [pageReference.alias] : []
		const searchKey = pageReference.pageTarget.toLowerCase();
		const page: PageNode = {
			nodeType: "page",
			isReference: true,
			page: pageReference.pageTarget,
			aliases: Array.isArray(aliases) ? aliases : [],
			tags: [],
			location: location,
			searchKey: searchKey,
			boost: calculateBoost("page", searchKey, ageDays),
			ageDays: ageDays
		}

		this.addOrUpdateNode(page)

		const header = this.createHeader(pageReference, location)
		if (header) {
			this.addOrUpdateNode(header)
			// we don't know if this is sub-header or a header
			// this.addChild(page, header, location, 0)
			return header
		}

		return page
	}

	private createMonthNode(page: DvPage, ts: number): MonthNode {
		const date = new Date(ts)
		const monthLiteral = date.toLocaleString('default', { month: 'long' });
		const searchKey = `${monthLiteral} ${date.getFullYear()}`.toLowerCase();
		const ageDays = getAgeDays(ts, page.file.name);
		const node: MonthNode = {
			nodeType: "month",
			month: date.getMonth() + 1,
			year: date.getFullYear(),
			monthLiteral: monthLiteral,
			location: {
				path: page.file.path,
				position: {start: {line: 0, ch: 0}, end: {line: 0, ch: 0}}
			},
			searchKey: searchKey,
			boost: calculateBoost("month", searchKey, ageDays), // Small base boost for month nodes
			ageDays: ageDays
		}

		this.addOrUpdateNode(node)

		return node
	}

	private createPageNode(page: DvPage): PageNode {
		const aliases = page.file.aliases?.values || []
		const tags = page.file.tags || []
		const searchKey = `${page.file.name}|${aliases.join(" ")}`.toLowerCase();
		const ageDays = getAgeDays(page.file.mtime.ts, page.file.name);
		const node: PageNode = {
			nodeType: "page",
			isReference: false,
			page: page.file.name,
			aliases: Array.isArray(aliases) ? aliases : [],
			tags: Array.isArray(tags) ? tags : [],
			location: {
				path: page.file.path,
				position: {start: {line: 0, ch: 0}, end: {line: 0, ch: 0}}
			},
			searchKey: searchKey,
            boost: calculateBoost("page", searchKey, ageDays),
			ageDays: ageDays
		}

		this.removeExistingPageEdges(node)
		this.addOrUpdateNode(node)

		// const monthNode = this.createMonthNode(page, page.file.mtime.ts)
		// this.addChild(monthNode, node, node.location, 0)

		return node
	}

    addAttachmentNode(file: TFile) {
        const searchKey = file.name.toLowerCase();
        const ageDays = getAgeDays(file.stat.mtime, file.name);
        const node: AttachmentNode = {
            nodeType: "attachment",
            name: file.name,
            extension: file.extension,
            location: {
                path: file.path,
                position: {start: {line: 0, ch: 0}, end: {line: 0, ch: 0}}
            },
            searchKey: searchKey,
            aliases: [],
            boost: calculateBoost("attachment", searchKey, ageDays),
            ageDays: ageDays
        }

        this.addOrUpdateNode(node)

        return node
    }

}

export function toLocation(position: DvList['position']): Location['position'] {
	return {start: {line: position.start.line, ch: position.start.col},
                end: {line: position.end.line, ch: position.end.col}}
}
