import {
    NotesGraph,
    parseVaultFile,
    parseCanvasData,
    indexSinglePage,
    type IndexSettings,
    type CanvasData,
} from "@mdtree/core";
import {TFile, TFolder} from "obsidian";
import {getSettings} from "../view/react-context/settings";
import {GlobalAtoms, GlobalStore} from "../view/react-context/global";

export class IndexedTree {
    private graph: NotesGraph;
    private isLoading = false;
    private version = 0;

    constructor(private store: GlobalStore) {
        this.graph = new NotesGraph();
    }

    async refreshPage(file: TFile) {
        await this.indexSingleFile(file, this.graph, this.toIndexSettings())
        console.debug(`indexed ${file.basename}`)
        this.setState(this.graph)
    }

    async refresh() {
        if (this.isLoading) return;
        this.isLoading = true;
        const newGraph = await this.rebuildEntireGraph()
        console.debug(`built new graph with ${newGraph.order} nodes`)
        this.setState(newGraph)
        this.isLoading = false
    }

    getState() {
        return this.graph;
    }

    private toIndexSettings(): IndexSettings {
        const s = getSettings(this.store)
        return {
            parentRelation: s.parentRelation,
            archiveTag: s.archiveTag,
            searchSeparator: s.searchSeparator,
        }
    }

    private setState(graph: NotesGraph) {
        this.graph = graph
        this.store.set(GlobalAtoms.graphAtom, graph)
        this.store.set(GlobalAtoms.graphVersionAtom, ++this.version)
        this.store.set(GlobalAtoms.isGraphLoadingAtom, false)
    }

    isIgnored(file: TFile | TFolder) {
        const app = this.store.get(GlobalAtoms.appAtom)
        return app.metadataCache.isUserIgnored && app.metadataCache.isUserIgnored(file.path)
    }

    * getAllFiles(): Generator<TFile | TFolder> {
        const app = this.store.get(GlobalAtoms.appAtom)
        if (!app) {
            return
        }

        const folders: TFolder[] = [app.vault.getRoot()];

        while (folders.length > 0) {
            const folder = folders[0];
            folders.shift();

            for (const child of folder.children) {
                if (child instanceof TFile && !this.isIgnored(child)) {
                    yield child;
                } else if (child instanceof TFolder) {
                    yield child;
                    folders.push(child);
                }
            }
        }
    }

    async * batchPages(batchSize: number): AsyncGenerator<(TFile | TFolder)[]> {
        const pages = this.getAllFiles();
        let batch: (TFile | TFolder)[] = [];

        for (const fileOrFolder of pages) {
            batch.push(fileOrFolder)

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
        const settings = this.toIndexSettings()

        for await (const batch of this.batchPages(10)) {
            await this.indexBatch(batch, graph, settings);
        }

        return graph;
    }

    private indexBatch(batch: (TFile | TFolder)[], graph: NotesGraph, settings: IndexSettings): Promise<boolean> {
        return new Promise((resolve) => {
            setTimeout(async () => {
                for (const page of batch) {
                    await this.indexSingleFile(page, graph, settings)
                }
                resolve(true)
            }, 0)
        })
    }

    private async indexFolder(folder: TFolder, graph: NotesGraph) {
        const location = {
            path: folder.path,
            position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } },
        }
        graph.createFolderNode(folder.path, folder.name, location)
    }

    private async indexSingleFile(page: TFile | TFolder, graph: NotesGraph, settings: IndexSettings) {
        if (page instanceof TFolder) {
            await this.indexFolder(page, graph)
            return;
        }

        const app = this.store.get(GlobalAtoms.appAtom)

        switch (page.extension) {
            case "md": {
                const content = await app.vault.read(page)
                const dvPage = parseVaultFile(content, page.path, page.stat.mtime, settings.archiveTag)
                indexSinglePage(dvPage, graph, settings)
                break;
            }
            case "canvas": {
                const content = await app.vault.read(page)
                let canvasData: CanvasData
                try {
                    canvasData = JSON.parse(content) as CanvasData
                } catch {
                    console.warn(`[mdtree] Failed to parse canvas: ${page.path}`)
                    return
                }
                parseCanvasData(page.path, page.basename, canvasData, graph)
                break;
            }
            default: {
                const location = {
                    path: page.path,
                    position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } },
                }
                graph.addAttachmentNode(page.basename, page.extension, page.path, page.stat.mtime)
                break;
            }
        }
    }
}
