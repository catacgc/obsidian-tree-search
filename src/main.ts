import {App, debounce, EventRef, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf} from 'obsidian';

import {SEARCH_VIEW, TreeSearch} from 'src/view/search/treesearch';
import {getAPI} from "obsidian-dataview";

import {IndexedTree} from "./indexed-tree";
import {PluginContextContainer, REACT_PLUGIN_CONTEXT} from "./view/react-context/PluginContext";
import {FILE_CONTEXT, FileContextView} from "./view/file-context/file-context";
import {ContextCodeBlock} from "./view/markdown-code-block/ContextCodeBlock";
import {GraphEvents} from "./view/obsidian-views/GraphEvents";
import {SearchModal} from "./view/search-modal/SearchModal";

export default class TreeSearchPlugin extends Plugin {
    index: IndexedTree
    private changedRef: EventRef
    private finishedRef: EventRef;
    context: PluginContextContainer = REACT_PLUGIN_CONTEXT

    async onunload() {
        this.changedRef && this.app.metadataCache.offref(this.changedRef)
        this.finishedRef && this.app.metadataCache.offref(this.finishedRef)
    }

    async onload() {
        const api = getAPI(this.app);
        if (!api) {
            throw new Error("Dataview is required to use this plugin");
        }

        this.index = new IndexedTree(api, this.app);

        this.registerView(
            SEARCH_VIEW,
            (leaf) => new TreeSearch(leaf, this.index)
        );

        this.registerView(
            FILE_CONTEXT,
            (leaf) => new FileContextView(leaf, this.index)
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

        const quickAddModal = new SearchModal(this.app, this.index);
        quickAddModal.setTitle("Search");

        this.addCommand({
            id: "search-modal",
            name: "Search",
            callback: () => {
                quickAddModal.open();
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

        this.addCommand({
            id: 'highlight-open',
            name: 'Highlight search result',
            callback: () => {
                const event = new CustomEvent('highlight-open', {detail: {message: 'Highlight command triggered'}});
                window.dispatchEvent(event);
            }
        });

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new SettingsTab(this.app, this));
        await this.loadSettings();

        // @ts-ignore
        this.registerEvent(this.app.workspace.on(GraphEvents.REFRESH_GRAPH, async () => {
            await this.index.refresh()
        }))

        const debouncer = debounce(async (file: TFile) => {
            await this.index.refreshPage(file)
        }, 500, true);

        this.registerEvent(this.app.metadataCache.on('changed', async (file) => {
            debouncer(file);
        }))

        this.registerMarkdownCodeBlockProcessor("tree-context", (source, element, context) => {
            context.addChild(new ContextCodeBlock(source, context, element,
                this.index, this.app
            ));
        });
    }

    async activateView(viewType = SEARCH_VIEW) {
        const {workspace} = this.app;

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
                await leaf.setViewState({type: viewType, active: true});
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
        this.context.settings = Object.assign({}, REACT_PLUGIN_CONTEXT.settings, await this.loadData());
        this.index.setSettings(this.context.settings);
    }

    async saveSettings() {
        await this.saveData(this.context.settings);
    }
}

class SettingsTab extends PluginSettingTab {
    plugin: TreeSearchPlugin;

    constructor(app: App, plugin: TreeSearchPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('Graph search separator')
            .setDesc('What you use to search between levels in the graph: e.g. `parent / child`')
            .addText(text => text
                .setPlaceholder('Search Separator')
                .setValue(this.plugin.context.settings.searchSeparator)
                .onChange(async (value) => {
                    this.plugin.context.settings.searchSeparator = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Parent relation')
            .setDesc('Frontmatter key that defines the parent relation')
            .addText(text => text
                .setPlaceholder('parent')
                .setValue(this.plugin.context.settings.parentRelation)
                .onChange(async (value) => {
                    this.plugin.context.settings.parentRelation = value;
                    await this.plugin.saveSettings();
                }));


        new Setting(containerEl)
            .setName('Archive tag')
            .setDesc('Archive tag to ignore notes, lines or sections / headers')
            .addText(text => text
                .setPlaceholder('archive')
                .setValue(this.plugin.context.settings.archiveTag)
                .onChange(async (value) => {
                    this.plugin.context.settings.archiveTag = value;
                    await this.plugin.saveSettings();
                }));
    }
}
