// import {Notice} from "obsidian";
import {NotesGraph} from "./graph";
import {TreeSearchSettings} from "./view/react-context/PluginContext";
import {HeadingCache} from "obsidian";

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
	parent?: number,
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
    headers: HeadingCache[]
}

// not interested in plain text or random paragraphs
function shouldSkip(lst: DvList, archiveTag: string) {
	if (lst.tags.includes(archiveTag)) return true

	if (lst.section.subpath) {
		const header = lst.section.subpath.replace(/#/g, " ").trim()
		if (header.startsWith('--') && header.endsWith('--')) return true
	}

	if (lst.tags.length > 0) return false;

	return !lst.text.includes("[[")
		&& !lst.text.includes('![[')
		&& !lst.text.startsWith('#')
		&& !lst.text.includes('http')
		&& !lst.task
		;
}

export async function indexSinglePage(page: DvPage, graph: NotesGraph, settings: TreeSearchSettings) {
	if ((page.file.frontmatter.tags || []).includes(settings.archiveTag)) return

	const pageRef = graph.addPageNode(page, settings.parentRelation)

	for (const item of page.file.lists.values) {
		item.text = item.text.trim()

		const lineArchiveTag = '#' + settings.archiveTag;
		if (shouldSkip(item, lineArchiveTag)) continue

		let childrenParent = item.text

		if (item.parent === undefined) {
			childrenParent = graph.createSubtree(pageRef, page, item)
		} else {
			// just create the node and later handle the edges
			graph.addItemNode(page, item)
		}

		for (const child of item.children) {
			if (shouldSkip(child, lineArchiveTag)) continue

			graph.createSubtree(childrenParent, page, child)
		}
	}
}





