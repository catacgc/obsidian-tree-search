import {App, debounce, EventRef, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf} from 'obsidian';

import {TreeSearch, VIEW_TYPE_NAME} from 'src/view/treesearch';
import {getAPI} from "obsidian-dataview";

import {IndexedTree} from "./indexed-tree";
import {PluginContextContainer, REACT_PLUGIN_CONTEXT} from "./view/PluginContext";


export default class TreeSearchPlugin extends Plugin {
	index: IndexedTree
	ref: EventRef
	context: PluginContextContainer = REACT_PLUGIN_CONTEXT

	async onunload() {
		this.ref && this.app.metadataCache.offref(this.ref)
	}

	async onload() {
		const api = getAPI(this.app);
		if (!api) {
			throw new Error("Obsidian Data View plugin is required to use this plugin");
		}

		this.index = new IndexedTree(api);
		await this.loadSettings();
		this.index.refresh()

		this.registerView(
			VIEW_TYPE_NAME,
			(leaf) => new TreeSearch(leaf, this.index)
		);

		this.addRibbonIcon("search", "Tree Search: Open", () => {
			this.activateView();
		});

		const debouncer = debounce(async (file: TFile) => {
			await this.index.refreshPage(file)
		}, 500, true);

		this.ref = this.app.metadataCache.on('changed', async (file) => {
			debouncer(file);
		})

		this.addCommand({
			id: 'parse-tree',
			name: 'Search',
			callback: () => this.activateView()
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SettingsTab(this.app, this));
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
			.setName('Graph Search Separator')
			.setDesc('What you use to search between levels in the graph: e.g. `parent / child`')
			.addText(text => text
				.setPlaceholder('Search Separator')
				.setValue(this.plugin.context.settings.searchSeparator)
				.onChange(async (value) => {
					this.plugin.context.settings.searchSeparator = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Parent Relation')
			.setDesc('Frontmatter key that defines the parent relation')
			.addText(text => text
				.setPlaceholder('parent')
				.setValue(this.plugin.context.settings.parentRelation)
				.onChange(async (value) => {
					this.plugin.context.settings.parentRelation = value;
					await this.plugin.saveSettings();
				}));


		new Setting(containerEl)
			.setName('Archive Tag')
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
