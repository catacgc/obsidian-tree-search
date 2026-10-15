import {App, debounce, EventRef, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf} from 'obsidian';

import {SEARCH_VIEW, SearchViewPanel} from './view/search/SearchViewPanel';
import {QuickLinkModal} from './view/search-modal/link-selector/QuickLinkModal';

import {IndexedTree} from "./indexing/indexed-tree";
import {FILE_CONTEXT, FileContextView} from "./view/file-context/file-context";
import {ContextCodeBlock} from "./view/markdown-code-block/ContextCodeBlock";
import {SearchModal} from "./view/search-modal/SearchModal";
import {archiveLine, archivePage, convertLegacyArchiveMarkers, highlightLine, insertLine, moveToFolder, openFileByName, revealFolder, showFolder, unarchiveLine, unarchivePage} from './obsidian-utils';
import {createStore} from 'jotai';
import {appendDraftAtom, getPluginData, getSettings, searchFiltersAtom, searchViewModesAtom, updateSettings} from './view/react-context/settings';
import './view/styles.css';
import {GlobalAtoms} from "./view/react-context/global";
import {resetDefaultInjector} from "bunshi";
import {RaycastServer} from "./view/raycast/raycast-server";
import {HOVER_SOURCE_ID} from "./view/hover-preview";
import {ORGANISE_VIEW, OrganiseView, type OrganiseViewState} from "./view/organise-notes/OrganiseView";

export default class TreeSearchPlugin extends Plugin {
    index: IndexedTree
    private changedRef: EventRef
    private finishedRef: EventRef;
    globalStore = createStore();
    private server: RaycastServer | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private refreshInterval: any = null;
    // The Append draft changes on every keystroke; persist it once typing pauses.
    private saveDraft = debounce(() => { void this.saveSettings() }, 500, true)

    async onunload() {
        console.log("Cleaning up after")
        this.server?.stop()
        // Flush a pending draft write while the store still holds the draft.
        this.saveDraft.run()
        this.globalStore = createStore()
        this.changedRef && this.app.metadataCache.offref(this.changedRef)
        this.finishedRef && this.app.metadataCache.offref(this.finishedRef)
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval)
        }
    }

    async onload() {
        resetDefaultInjector()
        this.globalStore = createStore()
        this.globalStore.set(GlobalAtoms.appAtom, this.app)

        this.index = new IndexedTree(this.globalStore, this.manifest.dir ?? "");
        this.globalStore.set(GlobalAtoms.indexAtom, this.index);

        this.registerView(
            SEARCH_VIEW,
            (leaf) => new SearchViewPanel(leaf, this.globalStore)
        );

        // Opt the tree-search view into the core Page Preview plugin. `defaultMod`
        // expresses the "Cmd/Ctrl+hover" gating and adds a Settings toggle; our
        // hover handlers forward the native event so Page Preview can enforce it.
        this.registerHoverLinkSource(HOVER_SOURCE_ID, {
            display: "Tree Search",
            defaultMod: true,
        });

        this.registerView(
            FILE_CONTEXT,
            (leaf) => new FileContextView(leaf, this.globalStore)
        );

        this.registerView(
            ORGANISE_VIEW,
            (leaf) => new OrganiseView(leaf, this.globalStore, () => this.index.refresh())
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

        const quickLinkModal = new QuickLinkModal(this.globalStore);
        quickLinkModal.setTitle("Insert Link");

        const searchModal = new SearchModal(this.globalStore);

        // Quick Add / Open editor: the Search modal in chip-less patch mode (its SearchBar starts it). With the
        // modal already showing its editor, the editor stays.
        const quickAdd = () => {
            const open = this.globalStore.get(GlobalAtoms.currentModalAtom) === searchModal
            if (open && this.globalStore.get(GlobalAtoms.editorHostAtom) === "modal") return
            this.globalStore.set(GlobalAtoms.quickAddRequestAtom, {view: "modal"});
            if (!open) searchModal.open();
        };

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
            id: "quick-add-modal",
            name: "Quick Add",
            callback: quickAdd,
        });

        this.addCommand({
            id: "open-editor",
            name: "Open editor",
            callback: quickAdd,
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
            id: 'organise-notes',
            name: 'Consolidate notes',
            callback: async () => {
                const activeFile = this.app.workspace.getActiveFile()

                if (!activeFile) {
                    new Notice("Open a note before organising it")
                    return
                }

                // Always the active note itself - never a wikilink under the
                // cursor, which silently retargeted the pane at that sub-topic
                // and pulled its children up into this (their grandparent) note.
                await this.consolidateNote(activeFile)
            }
        });

        this.addCommand({
            id: 'convert-legacy-archive',
            name: 'Convert legacy archive markers to #archive',
            callback: async () => {
                const {files, lines} = await convertLegacyArchiveMarkers(this.app, getSettings(this.globalStore).archiveTag)
                // Reindexed here: the shared modify debounce drops reindexes when several files change at once.
                for (const file of files) await this.index.refreshPage(file)
                new Notice(`Converted ${lines} ${lines === 1 ? "line" : "lines"} in ${files.length} ${files.length === 1 ? "note" : "notes"}`)
            }
        });

        this.addSettingTab(new SettingsTab(this.app, this));
        await this.loadSettings();
        // Tree/Timeline toggles and filter pills persist each change.
        this.register(this.globalStore.sub(searchViewModesAtom, () => { void this.saveSettings() }))
        this.register(this.globalStore.sub(searchFiltersAtom, () => { void this.saveSettings() }))
        this.register(this.globalStore.sub(appendDraftAtom, () => this.saveDraft()))

        this.server = new RaycastServer(this.globalStore);
        this.server.start();

        const store = this.globalStore
        store.sub(GlobalAtoms.isGraphLoadingAtom, async () => {
            const reload = store.get(GlobalAtoms.isGraphLoadingAtom)
            if (reload) {
                console.debug("Graph refresh requested")
                await this.index.refresh()
            }
        })

        this.refreshInterval = setInterval(() => {
            const loading = store.get(GlobalAtoms.isGraphLoadingAtom)
            const graph = store.get(GlobalAtoms.graphAtom)
            if (!loading && graph.order === 0) store.set(GlobalAtoms.isGraphLoadingAtom, true)
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
            context.addChild(new ContextCodeBlock(source, context, element, this.globalStore));
        });

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
            } else if (uri.raycastaction === "revealFolder") {
                await showFolder(this.app, uri.filepath)
            } else if (uri.raycastaction === "open") {
                await openFileByName(this.app, uri.filepath + (uri.hash ? `#${uri.hash}` : ""))
            } else if (uri.raycastaction === "moveToFolder") {
                moveToFolder(this.app, uri.filepath)
            } else if (uri.raycastaction === "archivePage") {
                await archivePage(this.app, uri.filepath, getSettings(this.globalStore).archiveTag)
            } else if (uri.raycastaction === "unarchivePage") {
                await unarchivePage(this.app, uri.filepath, getSettings(this.globalStore).archiveTag)
            } else if (uri.raycastaction === "archive") {
                await archiveLine(this.app, location, getSettings(this.globalStore).archiveTag)
            } else if (uri.raycastaction === "unarchive") {
                await unarchiveLine(this.app, location, getSettings(this.globalStore).archiveTag)
            } else if (uri.raycastaction === "pullChildren") {
                // The selected page's own note, never the active one: pairing the page's key with
                // whatever note was open gathered its children into that unrelated note.
                const file = this.app.vault.getFileByPath(uri.filepath)
                if (!file) new Notice(`Tree Search: note "${uri.filepath}" not found`)
                else await this.consolidateNote(file)
            } else {
                await highlightLine(this.app, location)
            }
        })

        await this.index.refresh()

        return true
    }

    /** Opens the Consolidate pane for `file`: everything nested under or mentioning it, gathered into it. */
    async consolidateNote(file: TFile): Promise<void> {
        // Reindex the organising note before building the preview, so a
        // run shortly after a previous one (e.g. from a different root)
        // sees the sections that run just wrote - otherwise resolveHome
        // and the preview's tree can miss content that's already there.
        await this.index.refreshPage(file)
        await this.openOrganiseView(`[[${file.basename.toLowerCase()}]]`, file.path)
    }

    async openOrganiseView(rootKey: string, notePath: string): Promise<void> {
        const { workspace } = this.app;
        const state: OrganiseViewState = { rootKey, notePath };

        const leaves = workspace.getLeavesOfType(ORGANISE_VIEW);
        const leaf = leaves.length > 0 ? leaves[0] : workspace.getRightLeaf(false);
        if (!leaf) return;

        await leaf.setViewState({ type: ORGANISE_VIEW, active: true, state });
        workspace.revealLeaf(leaf);
    }

    async activateView(viewType = SEARCH_VIEW) {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(viewType);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({ type: viewType, active: true });
            }
        }

        if (leaf) workspace.revealLeaf(leaf);

        setTimeout(() => {
            const inputEl = leaf?.view.containerEl.querySelector('input');
            inputEl?.select()
        }, 0);
    }

    async loadSettings() {
        updateSettings(this.globalStore, await this.loadData())
        await this.saveSettings();
    }

    async saveSettings() {
        await this.saveData(getPluginData(this.globalStore));
    }
}

class SettingsTab extends PluginSettingTab {
    plugin: TreeSearchPlugin;

    constructor(app: App, plugin: TreeSearchPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const settings = getSettings(this.plugin.globalStore)
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
            .setDesc("Tag that archives a note (in its frontmatter), a heading's section or a line and everything under it")
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

        const div = containerEl.createDiv()
        div.setCssStyles({ fontStyle: "italic", borderTop: "1px solid #ddd" })
        const helpDesc = document.createDocumentFragment();
        helpDesc.append("v" + this.plugin.manifest.version, " • ");
        helpDesc.append(helpDesc.createEl("a", { href: "https://github.com/catacgc/obsidian-tree-search/releases/tag/" + this.plugin.manifest.version, text: "What's new" }))
        helpDesc.append(" • ");
        helpDesc.append(helpDesc.createEl("a", { href: "https://catacgc.github.io/obsidian-tree-search/", text: "Documentation" }))
        helpDesc.append(" • ");
        helpDesc.append(helpDesc.createEl("a", { href: "https://github.com/catacgc/obsidian-tree-search", text: "Repo & Issue Reporting" }))
        div.append(helpDesc)
    }
}
