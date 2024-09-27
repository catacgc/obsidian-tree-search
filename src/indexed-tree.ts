import {NotesGraph} from "./graph";
import {DvAPIInterface} from "obsidian-dataview/lib/typings/api";
import {TFile} from "obsidian";
import {DvPage, indexSinglePage} from "./tree-builder";
import {REACT_PLUGIN_CONTEXT, TreeSearchSettings} from "./view/PluginContext";

export class IndexedTree {
	private graph: NotesGraph;
	private dv: DvAPIInterface
	private version = 0;
	private changeHandler: (props: {graph: NotesGraph, version: number}) => void;
	private settings: TreeSearchSettings;

	constructor(dv: DvAPIInterface) {
		this.graph = new NotesGraph();
		this.dv = dv;
		this.settings = REACT_PLUGIN_CONTEXT.settings
	}

	setSettings(settings: TreeSearchSettings) {
		this.settings = settings;
	}

	async refreshPage(file: TFile) {
		const page = this.dv.page(file.path)
		if (!page) return
		await indexSinglePage(page as DvPage, this.graph, this.settings);
		this.setState(this.graph)
	}

	async refresh() {
		const newGraph = await this.rebuildEntireGraph()
		this.setState(newGraph)
	}

	onChange(handler: (props: {graph: NotesGraph, version: number}) => void) {
		this.changeHandler = handler;
	}

	getState() {
		return this.graph;
	}

	private setState(graph: NotesGraph) {
		this.graph = graph;
		const version = this.version++
		if (this.changeHandler) this.changeHandler({graph, version});
	}

	private async rebuildEntireGraph(): Promise<NotesGraph> {

		const pages = this.dv.pages("")

		const graph = new NotesGraph();

		for (const dvp of pages) {
			const page = dvp as DvPage;
			if (page.file.name == "Obsidian Tree Search Plugin") {
				// console.log(page)
			}
			await indexSinglePage(page, graph, this.settings);
		}

		return graph;
	}
}
