import {Notice} from "obsidian";
import {getAPI} from "obsidian-dataview";
import {NotesGraph} from "./graph";

export type Index = {
	graph: NotesGraph
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
	section: {
		subpath: string // header
	},
	task: boolean,
	completed: boolean
}

export type DvPage = {
	file: {
		aliases: { values: string[] },
		name: string,
		mtime: { ts: number, c: { year: number, month: number, day: number } },
		path: string,
		frontmatter: Record<string, any>,
		lists: { values: DvList[] },
		tags: string[]
	},
}

// not interested in plain text or random paragraphs
function shouldSkip(lst: DvList) {
	return !lst.text.includes("[[")
		&& !lst.text.includes('![[')
		&& !lst.text.startsWith('#')
		&& !lst.text.includes('http')
		&& !lst.task
		;
}

export function indexSinglePage(page: DvPage, graph: NotesGraph) {
	const pageRef = graph.addPageNode(page)

	for (const item of page.file.lists.values) {
		if (shouldSkip(item)) continue

		if (!item.parent) {
			graph.createSubtree(pageRef, page, item)
		} else {
			// just create the node and later handle the edges
			graph.addItemNode(page, item)
		}

		for (const child of item.children) {
			if (shouldSkip(child)) continue

			graph.createSubtree(item.text, page, child)
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
		// .where(it => it.file.name == "ImportantProjects")

	const graph = new NotesGraph();
	const idx: Index = {graph: graph}

	for (const dvp of pages) {
		if (dvp.file.name == "TreeTest") {
			console.log(dvp)
		}
		const page = dvp as DvPage;
		indexSinglePage(page, graph);
	}

	return idx;
}


