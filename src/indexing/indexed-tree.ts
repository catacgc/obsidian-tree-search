import {NotesGraph} from "../graph";
import {DvAPIInterface} from "obsidian-dataview/lib/typings/api";
import {App, TFile, TFolder} from "obsidian";
import {DvPage, indexSinglePage, MarkdownIndexer} from "./markdown";
import {getSettings, TreeSearchSettings} from "../view/react-context/settings";
import { getDefaultStore } from "jotai";
import { graphAtom, graphVersionAtom, isGraphLoadingAtom } from "../view/react-context/state";
import { CanvasIndexer } from "./canvas";

export interface Indexer<T> {
	index(source: T, graph: NotesGraph, settings: TreeSearchSettings): Promise<NotesGraph>
}

export class IndexedTree {
	private graph: NotesGraph;
    private isLoading = false;
	private version = 0;

    constructor(private app: App, 
			private markdown: MarkdownIndexer,
			private canvas: CanvasIndexer,
			private extensions: Indexer<any>[] = []) {
		this.graph = new NotesGraph();
	}

	async refreshPage(file: TFile) {
		await this.indexSinglePage(file, this.graph, getSettings())
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

	isIgnored(file: TFile | TFolder) {
		return this.app.metadataCache.isUserIgnored && this.app.metadataCache.isUserIgnored(file.path)
	}

	/**
	 * Gets all files from the Obsidian vault
	 */
	* getAllFiles(): Generator<TFile | TFolder> {
		const folders: TFolder[] = [this.app.vault.getRoot()];
		
		while (folders.length > 0) {
			const folder = folders[0];
			folders.shift();

			for (const child of folder.children) {
				if (child instanceof TFile && !this.isIgnored(child)) {
					yield child;
				} else if (child instanceof TFolder) {
					folders.push(child);
				}
			}
		}
	}

	// index all pages in async batches to not block the main thread
	async * batchPages(batchSize: number): AsyncGenerator<(TFile|TFolder)[]> {
		const pages = this.getAllFiles();
		let batch: (TFile|TFolder)[] = [];

		for (const fileOrFolder of pages) {
			if (fileOrFolder instanceof TFolder) {
				batch.push(fileOrFolder)
			}

			if (fileOrFolder instanceof TFile) {
				batch.push(fileOrFolder)
			}

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

		for await (const batch of this.batchPages(10)) {
			await this.indexBatch(batch, graph);
		}

		return graph;
	}

	private indexBatch(batch: (TFile|TFolder)[], graph: NotesGraph) : Promise<boolean> {
		const settings = getSettings()
		return new Promise((resolve) => {
			setTimeout(async () => {
				for (const page of batch) {
					await this.indexSinglePage(page, graph, settings)
					resolve(true)
				}
			}, 0)
		})
	}

	private async indexSinglePage(page: TFile|TFolder, graph: NotesGraph, settings: TreeSearchSettings) {
		if (page instanceof TFolder) {
			return;
		}

		switch (page.extension) {
			case "md":
				await this.markdown.index(page, graph, settings);
				break;
			case "canvas":
				await this.canvas.index(page, graph, settings);
				break;
		}
	}
}
