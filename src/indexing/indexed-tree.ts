import { NotesGraph, buildGraphFromScanner, reindexFileInGraph, type ParserProvider } from "@mdtree/core"
import { TFile } from "obsidian"
import { getSettings } from "../view/react-context/settings"
import { GlobalAtoms, GlobalStore } from "../view/react-context/global"
import { ObsidianVaultScanner } from "./obsidian-vault-scanner"

export class IndexedTree {
    private graph: NotesGraph
    private isLoading = false
    private version = 0
    private provider: ParserProvider | undefined

    constructor(private store: GlobalStore) {
        this.graph = new NotesGraph()
    }

    setParserProvider(provider: ParserProvider): void {
        this.provider = provider
    }

    private get vault() {
        return this.store.get(GlobalAtoms.appAtom).vault
    }

    private get metadataCache() {
        return this.store.get(GlobalAtoms.appAtom).metadataCache
    }

    async refresh(): Promise<void> {
        if (this.isLoading) return
        this.isLoading = true
        try {
            const settings = getSettings(this.store)
            const graph = await buildGraphFromScanner(
                new ObsidianVaultScanner(this.vault, this.metadataCache),
                {
                    parentRelation: settings.parentRelation,
                    archiveTag: settings.archiveTag,
                    searchSeparator: settings.searchSeparator,
                },
                this.provider,
            )
            this.setState(graph)
        } finally {
            this.isLoading = false
        }
    }

    async refreshPage(file: TFile): Promise<void> {
        try {
            const settings = getSettings(this.store)
            await reindexFileInGraph(
                file.path,
                this.graph,
                new ObsidianVaultScanner(this.vault, this.metadataCache),
                {
                    parentRelation: settings.parentRelation,
                    archiveTag: settings.archiveTag,
                    searchSeparator: settings.searchSeparator,
                },
                this.provider,
            )
            this.setState(this.graph)
        } catch (err) {
            console.warn(`[mdtree] Failed to reindex ${file.path}:`, err)
        }
    }

    private setState(graph: NotesGraph): void {
        this.graph = graph
        this.store.set(GlobalAtoms.graphAtom, graph)
        this.store.set(GlobalAtoms.graphVersionAtom, ++this.version)
        this.store.set(GlobalAtoms.isGraphLoadingAtom, false)
    }
}
