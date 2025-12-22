import { App, debounce, EventRef, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from 'obsidian';

import { SEARCH_VIEW, SearchViewPanel } from './view/search-view-panel/search-view-panel';
import { QuickLinkModal } from './view/search-modal/link-selector/QuickLinkModal';
import { getAPI } from "obsidian-dataview";

import { IndexedTree } from "./indexing/indexed-tree";
import { FILE_CONTEXT, FileContextView } from "./view/search-file-context/file-context";
import { MarkdownCodeBlock } from "./view/search-markdown-code-block/markdown-code-block";
import { SearchModal } from "./view/search-modal/search-modal";
import { highlightLine, insertLine, moveToFolder, openFileByName, revealFolder, showFolder } from './obsidian-utils';
import { createStore } from 'jotai';
import { getSettings, updateSettings } from './view/react-context/settings';
import { RaycastServer } from './view/raycast/raycast-server';
import { MarkdownIndexer } from './indexing/markdown';
import { CanvasIndexer } from './indexing/canvas';
import './view/styles.css';
import { GlobalAppMolecule } from "./view/react-context/global";
import { getDefaultInjector, MoleculeInterface, resetDefaultInjector } from "bunshi";

export default class TreeSearchPlugin extends Plugin {
    index: IndexedTree
    private changedRef: EventRef
    private finishedRef: EventRef;
    private server: RaycastServer | null = null;
    private refreshInterval: number | null = null;

    async onunload() {
        console.log("Cleaning up after")


        this.changedRef && this.app.metadataCache.offref(this.changedRef)
        this.finishedRef && this.app.metadataCache.offref(this.finishedRef)
        this.server?.stop()
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval)
        }
    }

    async onload() {
        resetDefaultInjector()
        const { setApp } = getDefaultInjector().get(GlobalAppMolecule)

        setApp(this.app)

        if (!await this.waitForDataview()) {
            // @ts-ignore
            this.app.metadataCache.on("dataview:index-ready", async () => await this.waitForDataview())
        }
    }

    async waitForDataview(): Promise<boolean> {
        const api = getAPI(this.app);
        if (!api) {
            return false
        }

        console.debug("Enabling tree search; dataview index ready")
        const { store } = getDefaultInjector().get(GlobalAppMolecule)

        const markdown = new MarkdownIndexer(api, this.app);
        const canvas = new CanvasIndexer(this.app);
        this.index = new IndexedTree(store, markdown, canvas);

        this.registerView(
            SEARCH_VIEW,
            (leaf) => new SearchViewPanel(leaf, store)
        );

        this.registerView(
            FILE_CONTEXT,
            (leaf) => new FileContextView(leaf, store)
        );

        this.addCommand({
            id: 'parse-tree',
            name: 'Search pane',
            callback: () => this.activateView(SEARCH_VIEW)
        });

        this.addCommand({
            id: 'file-context',
            name: 'File context',
            callback: () => this.activateView(FILE_CONTEXT)
        });

        const quickLinkModal = new QuickLinkModal(store);
        quickLinkModal.setTitle("Insert Link");

        const searchModal = new SearchModal(store);
        searchModal.setTitle("Search");

        this.addCommand({
            id: "quick-link-modal",
            name: "Quick Link",
            callback: () => {
                quickLinkModal.open();
            },
        });

        this.addCommand({
            id: "search-modal",
            name: "Search",
            callback: () => {
                searchModal.open();
            },
        });

        this.addCommand({
            id: 'Refresh-tree',
            name: 'Refresh',
            callback: () => {
                this.index.refresh()
                new Notice("Graph refreshed")
            }
        });

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new SettingsTab(this.app, this));
        await this.loadSettings();

        const { isGraphLoadingAtom } = getDefaultInjector().get(GlobalAppMolecule)

        /**
         * Load the graph when the plugin is loaded
         */
        store.sub(isGraphLoadingAtom, async () => {
            const reload = store.get(isGraphLoadingAtom)

            // anything changed
            if (reload) {
                console.debug("Graph refresh requested")
                await this.index.refresh()
            }
        })

        this.refreshInterval = setInterval(() => {
            const loading = store.get(isGraphLoadingAtom)
            const { graphAtom } = getDefaultInjector().get(GlobalAppMolecule)
            const graph = store.get(graphAtom)

            if (!loading && graph.graph.nodes().length === 0) store.set(isGraphLoadingAtom, true)


        }, 2000, 5);


        const debouncer = debounce(async (file: TFile) => {
            await this.index.refreshPage(file)
        }, 200, true);

        this.registerEvent(this.app.vault.on('modify', async (file) => {
            if (file instanceof TFile) {
                debouncer(file)
            }
        }))

        this.registerMarkdownCodeBlockProcessor("tree-context", (source, element, context) => {
            context.addChild(new MarkdownCodeBlock(source, context, element, store));
        });

        // this will handle the tree-search-uri protocol coming from raycast
        this.registerObsidianProtocolHandler("tree-search-uri", async (uri) => {
            const location = {
                path: uri.filepath,
                position: {
                    start: { line: parseInt(uri.sl), ch: parseInt(uri.sc) },
                    end: { line: parseInt(uri.el), ch: parseInt(uri.ec) }
                }
            }

            if (uri.raycastaction === "insert") {
                await insertLine(this.app, location)
            } else if (uri.raycastaction == "revealFolder") {
                await showFolder(this.app, uri.filepath)
            } if (uri.raycastaction == "open") {
                await openFileByName(this.app, uri.filepath + (uri.hash ? `#${uri.hash}` : ""))
            } else if (uri.raycastaction == "moveToFolder") {
                moveToFolder(this.app, uri.filepath)
            } else {
                await highlightLine(this.app, location)
            }
        })

        this.server = new RaycastServer(store)
        this.server.start()

        return true
    }


    async activateView(viewType = SEARCH_VIEW) {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(viewType);

        if (leaves.length > 0) {
            // A leaf with our view already exists, use that
            leaf = leaves[0];
        } else {
            // Our view could not be found in the workspace, create a new leaf
            // in the right sidebar for it
            leaf = workspace.getRightLeaf(false);

            if (leaf) {
                await leaf.setViewState({ type: viewType, active: true });
            }
        }

        // "Reveal" the leaf in case it is in a collapsed sidebar
        if (leaf) workspace.revealLeaf(leaf);

        setTimeout(() => {
            const inputEl = leaf?.view.containerEl.querySelector('input');
            inputEl?.select()
        }, 0);
    }

    async loadSettings() {
        const { store } = getDefaultInjector().get(GlobalAppMolecule)
        updateSettings(store, await this.loadData())
        await this.saveSettings(); // do this to make sure to create data.json
    }

    async saveSettings() {
        const { store } = getDefaultInjector().get(GlobalAppMolecule)
        await this.saveData(getSettings(store));
    }
}

class SettingsTab extends PluginSettingTab {
    plugin: TreeSearchPlugin;

    constructor(app: App, plugin: TreeSearchPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { store } = getDefaultInjector().get(GlobalAppMolecule)
        const settings = getSettings(store)
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('Graph search separator')
            .setDesc('What you use to search between levels in the graph: e.g. `parent / child`')
            .addText(text => text
                .setPlaceholder('Search Separator')
                .setValue(settings.searchSeparator)
                .onChange(async (value) => {
                    settings.searchSeparator = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Parent relation')
            .setDesc('Frontmatter key that defines the parent relation')
            .addText(text => text
                .setPlaceholder('parent')
                .setValue(settings.parentRelation)
                .onChange(async (value) => {
                    settings.parentRelation = value;
                    await this.plugin.saveSettings();
                }));


        new Setting(containerEl)
            .setName('Archive tag')
            .setDesc('Archive tag to ignore notes, lines or sections / headers')
            .addText(text => text
                .setPlaceholder('archive')
                .setValue(settings.archiveTag)
                .onChange(async (value) => {
                    settings.archiveTag = value;
                    await this.plugin.saveSettings();
                }));

        const socketPath = settings.socketPath.replace("{vaultname}", this.app.vault.getName())
        new Setting(containerEl)
            .setName('Raycast API socket path')
            .setDesc('Copy this when configuring the companion Raycast extension')
            .addExtraButton((component) => {
                component.setIcon("copy")
                component.onClick(() => {
                    navigator.clipboard.writeText(socketPath)
                    new Notice("Copied to clipboard")
                })
            })
            .addText(text => text
                .setPlaceholder('socket')
                .setValue(socketPath)
                .setDisabled(true));

        // no need so far to do this configurable
        // .onChange(async (value) => {
        //     this.plugin.context.settings.socketPath = value;
        //     await this.plugin.saveSettings();
        // }));

        const div = containerEl.createDiv()
        div.setCssStyles({ fontStyle: "italic", borderTop: "1px solid #ddd" })
        const helpDesc = document.createDocumentFragment();
        helpDesc.append("v" + this.plugin.manifest.version, " • ");
        const strippedVersion = this.plugin.manifest.version.replace(/^v/, "").replace(/\./g, "");
        helpDesc.append(helpDesc.createEl("a", { href: "https://catacgc.github.io/tree-search-docs/ReleaseNotes#" + strippedVersion, text: "What's new" }))
        helpDesc.append(" • ");
        helpDesc.append(helpDesc.createEl("a", { href: "https://catacgc.github.io/tree-search-docs", text: "Documentation" }))
        helpDesc.append(" • ");
        helpDesc.append(helpDesc.createEl("a", { href: "https://github.com/catacgc/obsidian-tree-search", text: "Repo & Issue Reporting" }))
        div.append(helpDesc)
    }
}
