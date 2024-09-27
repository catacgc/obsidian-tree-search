import {
	App, debounce,
	Editor, EventRef,
	MarkdownView,
	Plugin,
	PluginSettingTab, Setting, TFile,
	WorkspaceLeaf
} from 'obsidian';

import {TreeSearch, VIEW_TYPE_NAME} from 'src/view/treesearch';
import {getAPI} from "obsidian-dataview";

import {IndexedTree} from "./src/indexed-tree";

interface TreeSearchSettings {
	searchSeparator: string;
}

const DEFAULT_SETTINGS: TreeSearchSettings = {
	searchSeparator: '>'
}

export default class TreeSearchPlugin extends Plugin {
	settings: TreeSearchSettings;
	index: IndexedTree
	ref: EventRef

	async onunload() {
		this.ref && this.app.metadataCache.offref(this.ref)
	}

	async onload() {

		const api = getAPI(this.app);
		if (api) {
			this.index = new IndexedTree(api);
			this.index.refresh()

			this.registerView(
				VIEW_TYPE_NAME,
				(leaf) => new TreeSearch(leaf, this.index)
			);
		} else {
			throw new Error("Obsidian Data View plugin is required to use this plugin");
		}

		this.addRibbonIcon("search", "Tree Search: Open", () => {
			this.activateView();
		});

		await this.loadSettings();

		const debouncer = debounce(async (file: TFile) => {
			await this.index.refreshPage(file)
		}, 500, true);

		this.ref = this.app.metadataCache.on('changed', async (file) => {
			debouncer(file);
		})

		this.addCommand({
			id: 'parse-tree',
			name: 'Search',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.activateView();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

	}

	async activateView() {
		const {workspace} = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_NAME);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		} else {
			// Our view could not be found in the workspace, create a new leaf
			// in the right sidebar for it
			leaf = workspace.getRightLeaf(false);

			if (leaf) {
				await leaf.setViewState({type: VIEW_TYPE_NAME, active: true});
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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: TreeSearchPlugin;

	constructor(app: App, plugin: TreeSearchPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Graph Levels Search Separator')
			.setDesc('What you use to search between levels in the graph: e.g. `parent > child`')
			.addText(text => text
				.setPlaceholder('Search Separator')
				.setValue(this.plugin.settings.searchSeparator)
				.onChange(async (value) => {
					this.plugin.settings.searchSeparator = value;
					await this.plugin.saveSettings();
				}));
	}
}
