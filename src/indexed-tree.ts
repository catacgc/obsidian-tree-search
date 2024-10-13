import {NotesGraph} from "./graph";
import {DvAPIInterface} from "obsidian-dataview/lib/typings/api";
import {App, TFile} from "obsidian";
import {DvPage, indexSinglePage} from "./tree-builder";
import {REACT_PLUGIN_CONTEXT, TreeSearchSettings} from "./view/react-context/PluginContext";

export class IndexedTree {
	private graph: NotesGraph;
    private isLoading = false;
	private version = 0;
	private changeHandlers: Array<(props: { graph: NotesGraph, version: number }) => void> = [];
	private settings: TreeSearchSettings;

    constructor(private dv: DvAPIInterface, private app: App) {
		this.graph = new NotesGraph();
		this.settings = REACT_PLUGIN_CONTEXT.settings
	}

	setSettings(settings: TreeSearchSettings) {
		this.settings = settings;
	}

	async refreshPage(file: TFile) {
		const page = this.dv.page(file.path)
		if (!page) return

        const cache = this.app.metadataCache.getCache(page.file.path);
        page.headers = cache?.headings ?? [];

		await indexSinglePage(page as DvPage, this.graph, this.settings);
		this.setState(this.graph)
	}

	async refresh() {
        if (this.isLoading) return;
        this.isLoading = true;
		const newGraph = await this.rebuildEntireGraph()
		this.setState(newGraph)
        this.isLoading = false
	}

	onChange(handler: (props: { graph: NotesGraph, version: number }) => void) {
		this.changeHandlers.push(handler);
	}

	getState() {
		return this.graph;
	}

	private setState(graph: NotesGraph) {
		this.graph = graph;
		const version = ++this.version
		this.changeHandlers.forEach(handler => handler({graph, version}));
	}

	// index all pages in async batches to not block the main thread
	* batchPages(batchSize: number): Generator<DvPage[]> {
		const pages = this.dv.pages("")
		let batch: DvPage[] = [];

		for (const dvp of pages) {
			const page = dvp as DvPage;

            const cache = this.app.metadataCache.getCache(page.file.path);
            page.headers = cache?.headings ?? [];

			batch.push(page);

            if (page.file.name == "ChildTestPage") {
                console.log(page)
                // console.log(cache)
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

		for (const batch of this.batchPages(10)) {
			await this.indexBatch(batch, graph);
		}

		return graph;
	}

	private indexBatch(batch: DvPage[], graph: NotesGraph) : Promise<boolean> {
		return new Promise((resolve) => {
			setTimeout(async () => {
				for (const page of batch) {
					await indexSinglePage(page, graph, this.settings);
					resolve(true)
				}
			}, 0)
		})
	}
}
