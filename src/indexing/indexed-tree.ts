import { NotesGraph, buildGraphFromScanner, reindexFileInGraph, type ParseCacheEntry, serializeCache, deserializeCache } from "@mdtree/core"
import { TFile } from "obsidian"
import { getSettings } from "../view/react-context/settings"
import { GlobalAtoms, GlobalStore } from "../view/react-context/global"
import { ObsidianVaultScanner } from "./obsidian-vault-scanner"

export class IndexedTree {
    private graph: NotesGraph
    private isLoading = false
    private version = 0
    private parseCache = new Map<string, ParseCacheEntry>()

    constructor(private store: GlobalStore, private cacheDir: string) {
        this.graph = new NotesGraph()
    }

    private get vault() {
        return this.store.get(GlobalAtoms.appAtom).vault
    }

    private get metadataCache() {
        return this.store.get(GlobalAtoms.appAtom).metadataCache
    }

    private get cachePath(): string {
        return `${this.cacheDir}/parse-cache.json`
    }

    private async loadCache(): Promise<void> {
        try {
            const json = await this.vault.adapter.read(this.cachePath)
            this.parseCache = deserializeCache(json)
        } catch {
            this.parseCache = new Map()
        }
    }

    private async saveCache(): Promise<void> {
        try {
            await this.vault.adapter.write(this.cachePath, serializeCache(this.parseCache))
        } catch (err) {
            console.warn("[mdtree] Failed to save parse cache:", err)
        }
    }

    async refresh(): Promise<void> {
        if (this.isLoading) return
        this.isLoading = true
        try {
            await this.loadCache()
            const settings = getSettings(this.store)
            const graph = await buildGraphFromScanner(
                new ObsidianVaultScanner(this.vault, this.metadataCache),
                {
                    parentRelation: settings.parentRelation,
                    archiveTag: settings.archiveTag,
                    searchSeparator: settings.searchSeparator,
                },
                this.parseCache,
            )
            await this.saveCache()
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
                this.parseCache,
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

    getCacheStats(): { size: number; entries: string[] } {
        const entries = Array.from(this.parseCache.keys())
        return { size: entries.length, entries }
    }

    clearCache(): void {
        this.parseCache.clear()
    }
}
