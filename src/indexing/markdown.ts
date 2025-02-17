// import {Notice} from "obsidian";
import {NotesGraph, ParsedNode} from "../graph";
import {TreeSearchSettings} from "../view/react-context/settings";
import {App, HeadingCache, TFile, TFolder} from "obsidian";
import { Indexer } from "./indexed-tree";
import { DvAPIInterface } from "obsidian-dataview/lib/typings/api";

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
	
	const pageNode = graph.addPageNode(page, settings.parentRelation, isArchived)

	 if (isArchived) return

	const lineArchiveTag = '#' + settings.archiveTag;

	createSubtree(pageNode, page.file.lists.values.filter(it => it.parent === undefined))

	function createSubtree(parent: ParsedNode, children: DvList[]) {
		for (const child of children) {
			child.text = child.text.trim()

			if (shouldSkip(child, lineArchiveTag)) continue

			const created = graph.createTreeFromTextLine(parent, page, child)
			createSubtree(created, child.children)
		}
	}
}

export class MarkdownIndexer implements Indexer<TFile> {
	constructor(private dv: DvAPIInterface, private app: App) {
	}
	
	async index(source: TFile, graph: NotesGraph, settings: TreeSearchSettings) {
		if (source.extension === "md") {
			const page = this.parseDvPage(source)
			if (!page) return graph;
			await indexSinglePage(page, graph, settings)
		}

		return graph;
	}


	private parseDvPage(page: TFile): DvPage | null {
		const dvpage = this.dv.page(page.path);
		if (!dvpage) {
			console.debug(`cannot find ${page.path} in dataview index`)
			return null;
		};

		const cache = this.app.metadataCache.getCache(dvpage.file.path);
		dvpage.headers = cache?.headings ?? [];
		return dvpage as DvPage;
	}
}


