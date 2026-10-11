import { NotesGraph, buildGraphFromScanner, reindexFileInGraph, makePeriodicDateResolver, extractPageDate, pageDateIso, type ParseCacheEntry, type IndexSettings, type PeriodicNoteConfig, type MomentParse, type SearchOptions, serializeCache, deserializeCache } from "@mdtree/core"
import { TFile, moment } from "obsidian"
import { getSettings } from "../view/react-context/settings"
import { GlobalAtoms, GlobalStore } from "../view/react-context/global"
import { ObsidianVaultScanner } from "./obsidian-vault-scanner"
import { dailyNotePath } from "../editing/vault-edits"

// Strict moment parse shared by the periodic-note resolver. Uses the `moment`
// bundled with Obsidian, so week/locale tokens (gggg, ww, MMM) match what the
// user's daily-notes settings render. Obsidian's `moment` re-export isn't typed
// as directly callable, so cast to the minimal signature we rely on.
type StrictMoment = (input: string, format: string, strict: boolean) => { isValid(): boolean; valueOf(): number }
const momentParse: MomentParse = (input, format) => {
    const m = (moment as unknown as StrictMoment)(input, format, true)
    return m.isValid() ? m.valueOf() : null
}

export type DailyNoteConfig = { folder: string; format: string; template: string }

export class IndexedTree {
    private graph: NotesGraph
    private isLoading = false
    private version = 0
    private parseCache = new Map<string, ParseCacheEntry>()
    // Resolves a vault path to a daily/weekly-note date; refreshed on full reindex.
    private periodicDate: (path: string) => number | null = () => null
    // Core "Daily Notes" plugin settings, read alongside the resolver; used by editor-mode appends.
    private dailyNoteConfig: DailyNoteConfig = { folder: "", format: "YYYY-MM-DD", template: "" }

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

    // Read the core "Daily Notes" plugin setting (daily-notes.json) and rebuild
    // the path→date resolver used to age daily/weekly notes. We deliberately do
    // NOT depend on the community "Periodic Notes" plugin.
    private async loadPeriodicResolver(): Promise<void> {
        const configs: PeriodicNoteConfig[] = []
        try {
            const daily = JSON.parse(await this.vault.adapter.read(`${this.vault.configDir}/daily-notes.json`))
            this.dailyNoteConfig = { folder: daily.folder ?? "", format: daily.format || "YYYY-MM-DD", template: daily.template ?? "" }
            configs.push({ folder: this.dailyNoteConfig.folder, format: this.dailyNoteConfig.format })
        } catch { /* no daily-notes config → nothing is a periodic note */ }

        this.periodicDate = makePeriodicDateResolver(configs, momentParse)
    }

    getDailyNoteConfig(): DailyNoteConfig {
        return this.dailyNoteConfig
    }

    /** The day (YYYY-MM-DD) undated lines of the indexed note at `path` are dated by (pageDateIso, as the indexer
     *  dates its page), else null. */
    lineDateOf(path: string): string | null {
        const fm = this.parseCache.get(path)?.page.file.frontmatter ?? {}
        return pageDateIso(path.split("/").pop()!.replace(/\.md$/, ""), extractPageDate(fm) ?? this.periodicDate(path))
    }

    /** Search context: today's daily note, the target of `outline:":daily"` (computed per call, so it follows the date). */
    searchOptions(): SearchOptions {
        return { dailyNote: dailyNotePath(this.dailyNoteConfig) }
    }

    private indexSettings(): IndexSettings {
        const settings = getSettings(this.store)
        return {
            parentRelation: settings.parentRelation,
            archiveTag: settings.archiveTag,
            searchSeparator: settings.searchSeparator,
            periodicDate: this.periodicDate,
        }
    }

    async refresh(): Promise<void> {
        if (this.isLoading) return
        this.isLoading = true
        try {
            await this.loadCache()
            await this.loadPeriodicResolver()
            const graph = await buildGraphFromScanner(
                new ObsidianVaultScanner(this.vault, this.metadataCache),
                this.indexSettings(),
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
            await reindexFileInGraph(
                file.path,
                this.graph,
                new ObsidianVaultScanner(this.vault, this.metadataCache),
                this.indexSettings(),
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
