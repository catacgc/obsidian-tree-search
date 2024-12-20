import {NotesGraph} from "./graph";
import {DvAPIInterface} from "obsidian-dataview/lib/typings/api";
import {App, TFile} from "obsidian";
import {DvPage, indexSinglePage} from "./tree-builder";
import {getSettings, TreeSearchSettings} from "./view/react-context/settings";
import { getDefaultStore } from "jotai";
import { graphAtom, graphVersionAtom, isGraphLoadingAtom } from "./view/react-context/state";

export class IndexedTree {
	private graph: NotesGraph;
    private isLoading = false;
	private version = 0;

    constructor(private dv: DvAPIInterface, private app: App) {
		this.graph = new NotesGraph();
	}

	async refreshPage(file: TFile) {
		const page = this.dv.page(file.path)
		if (!page) return

        const cache = this.app.metadataCache.getCache(page.file.path);
        page.headers = cache?.headings ?? [];

		await indexSinglePage(page as DvPage, this.graph, getSettings());
		console.debug(`indexed ${file.basename}`)
		this.setState(this.graph)
	}

	async refresh() {
        if (this.isLoading) return;
        this.isLoading = true;
		const newGraph = await this.rebuildEntireGraph()
		console.debug(`built new graph with ${newGraph.graph.size} nodes` )
		this.setState(newGraph)
        this.isLoading = false
	}

	getState() {
		return this.graph;
	}

	private setState(graph: NotesGraph) {
		this.graph = graph
		getDefaultStore().set(graphAtom, graph)
		getDefaultStore().set(graphVersionAtom, ++this.version)
		getDefaultStore().set(isGraphLoadingAtom, false)
	}

	// index all pages in async batches to not block the main thread
	* batchPages(batchSize: number): Generator<DvPage[]> {
		const pages = this.dv.pages("")
		let batch: DvPage[] = [];

		for (const dvp of pages) {
			const page = dvp as DvPage;

			if (this.app.metadataCache.isUserIgnored &&
				this.app.metadataCache.isUserIgnored(page.file.path)) {
					continue
				}

			const cache = this.app.metadataCache.getCache(page.file.path);
			page.headers = cache?.headings ?? [];

			batch.push(page);

			if (batch.length === batchSize) {
				yield batch;
				batch = [];
			}
		}

		if (batch.length > 0) {
			yield batch;
		}
	}

	private async rebuildEntireGraph(): Promise<NotesGraph> {

		const graph = new NotesGraph();

		for (const batch of this.batchPages(10)) {
			await this.indexBatch(batch, graph);
		}

		return graph;
	}

	private indexBatch(batch: DvPage[], graph: NotesGraph) : Promise<boolean> {
		const settings = getSettings()
		return new Promise((resolve) => {
			setTimeout(async () => {
				for (const page of batch) {
					await indexSinglePage(page, graph, settings);
					resolve(true)
				}
			}, 0)
		})
	}
}
