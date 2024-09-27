// import {Notice} from "obsidian";
import {NotesGraph} from "./graph";

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

export async function indexSinglePage(page: DvPage, graph: NotesGraph) {
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





