import { NotesGraph } from "@mdtree/core"
import { buildGraph, reindexFile } from "@mdtree/cli/vault"
import { TFile, FileSystemAdapter } from "obsidian"
import { join } from "node:path"
import { getSettings } from "../view/react-context/settings"
import { GlobalAtoms, GlobalStore } from "../view/react-context/global"

export class IndexedTree {
    private graph: NotesGraph
    private isLoading = false
    private version = 0

    constructor(private store: GlobalStore) {
        this.graph = new NotesGraph()
    }

    private get vaultPath(): string {
        const adapter = this.store.get(GlobalAtoms.appAtom).vault.adapter
        if (!(adapter instanceof FileSystemAdapter)) {
            throw new Error("IndexedTree only works on desktop (FileSystemAdapter required)")
        }
        return adapter.basePath
    }

    async refresh(): Promise<void> {
        if (this.isLoading) return
        this.isLoading = true
        const settings = getSettings(this.store)
        const graph = await buildGraph(this.vaultPath, {
            parentRelation: settings.parentRelation,
            archiveTag: settings.archiveTag,
            searchSeparator: settings.searchSeparator,
        })
        this.setState(graph)
        this.isLoading = false
    }

    async refreshPage(file: TFile): Promise<void> {
        const absPath = join(this.vaultPath, file.path)
        const settings = getSettings(this.store)
        await reindexFile(absPath, this.vaultPath, this.graph, {
            parentRelation: settings.parentRelation,
            archiveTag: settings.archiveTag,
            searchSeparator: settings.searchSeparator,
        })
        this.setState(this.graph)
    }

    private setState(graph: NotesGraph): void {
        this.graph = graph
        this.store.set(GlobalAtoms.graphAtom, graph)
        this.store.set(GlobalAtoms.graphVersionAtom, ++this.version)
        this.store.set(GlobalAtoms.isGraphLoadingAtom, false)
    }
}
