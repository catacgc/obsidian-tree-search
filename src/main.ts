import { App, debounce, EventRef, Notice, Platform, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from 'obsidian';

import { SEARCH_VIEW, SearchModalComponent } from './view/search/SearchModalComponent';
import { getAPI } from "obsidian-dataview";

import { IndexedTree } from "./indexed-tree";
import { FILE_CONTEXT, FileContextView } from "./view/file-context/file-context";
import { ContextCodeBlock } from "./view/markdown-code-block/ContextCodeBlock";
import { GraphEvents } from "./view/obsidian-views/GraphEvents";
import { SearchModal } from "./view/search-modal/SearchModal";
import fs from 'fs';

import http, { IncomingMessage, ServerResponse } from 'http'
import { searchIndex } from './search';
import { highlightLine, insertLine } from './obsidian-utils';
import { getDefaultStore } from 'jotai';
import { flattenIndex, isGraphLoadingAtom } from './view/react-context/state';
import { getSettings, updateSettings } from './view/react-context/settings';

export default class TreeSearchPlugin extends Plugin {
    index: IndexedTree
    private changedRef: EventRef
    private finishedRef: EventRef;
    private server: http.Server | null = null;
    

    async onunload() {
        this.changedRef && this.app.metadataCache.offref(this.changedRef)
        this.finishedRef && this.app.metadataCache.offref(this.finishedRef)
        this.server?.close()
    }

    async onload() {
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

        this.index = new IndexedTree(api, this.app);

        this.registerView(
            SEARCH_VIEW,
            (leaf) => new SearchModalComponent(leaf, this.index)
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
                const event = new CustomEvent('highlight-open', { detail: { message: 'Highlight command triggered' } });
                window.dispatchEvent(event);
            }
        });

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new SettingsTab(this.app, this));
        await this.loadSettings();

        const store = getDefaultStore()
        store.sub(isGraphLoadingAtom, async () => {
            const reload = store.get(isGraphLoadingAtom)
            console.debug("Graph refresh requested")
            if (reload) await this.index.refresh()
        })

        const debouncer = debounce(async (file: TFile) => {
            await this.index.refreshPage(file)
        }, 200, true);

        this.registerEvent(this.app.metadataCache.on('changed', async (file) => {
            debouncer(file);
        }))

        this.registerMarkdownCodeBlockProcessor("tree-context", (source, element, context) => {
            context.addChild(new ContextCodeBlock(source, context, element,
                this.index, this.app
            ));
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
            } else {

                await highlightLine(this.app, location)
            }
        })

        this.createRaycastSocket()

        return true
    }

    createRaycastSocket() {
        if (!Platform.isDesktopApp || !Platform.isMacOS || Platform.isMobileApp || Platform.isMobile) return;

        const requestListener = (req: IncomingMessage, res: ServerResponse) => {
            // parse query parameters from url
            const query = new URL(req.url || "", "http://localhost").searchParams.get("query");
            const limit = parseInt(new URL(req.url || "", "http://localhost").searchParams.get("limit") || "100");

            // decode the url
            const decodedQuery = decodeURIComponent(query || "");

            if (!decodedQuery) {
                res.end("No query provided  ");
            }

            const result = searchIndex(this.index.getState().graph, decodedQuery, ".");
            const flattened = flattenIndex(result)
            const jsonContent = JSON.stringify(flattened.slice(0, limit));
            res.end(jsonContent);
        };

        this.server = http.createServer(requestListener);
        const socketFileName = getSettings().socketPath.replace("{vaultname}", this.app.vault.getName());

        // delete socketFileName if it exists
        if (fs.existsSync(socketFileName)) {
            fs.unlink(socketFileName, (err: any) => {
                if (err) {
                    console.error(err)
                }
            });
        }


        this.server.listen(socketFileName, function () {
            console.log("Server is Listening at Port " + socketFileName);
        });
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
        updateSettings(await this.loadData())
        await this.saveSettings(); // do this to make sure to create data.json
    }

    async saveSettings() {
        await this.saveData(getSettings());
    }
}

class SettingsTab extends PluginSettingTab {
    plugin: TreeSearchPlugin;

    constructor(app: App, plugin: TreeSearchPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const settings = getSettings()
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
