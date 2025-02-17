// import {Notice} from "obsidian";
import {NotesGraph, ParsedNode} from "./graph";
import {TreeSearchSettings} from "./view/react-context/settings";
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

	const isArchived = (page.file.frontmatter.tags || []).includes(settings.archiveTag)
	
	const pageRef = graph.addPageNode(page, settings.parentRelation, isArchived)

	 if (isArchived) return

	const lineArchiveTag = '#' + settings.archiveTag;

	createSubtree(pageRef, page.file.lists.values.filter(it => it.parent === undefined))

	function createSubtree(parent: ParsedNode, children: DvList[]) {
		for (const child of children) {
			child.text = child.text.trim()

			if (shouldSkip(child, lineArchiveTag)) continue

			const created = graph.createTreeFromTextLine(parent, page, child)
			createSubtree(created, child.children)
		}
	}
}





