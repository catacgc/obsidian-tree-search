import {
	App,
	Editor,
	MarkdownView,
	Plugin,
	PluginSettingTab,
	WorkspaceLeaf
} from 'obsidian';

import {TreeSearch, VIEW_TYPE_NAME} from 'src/view/treesearch';

interface TreeSearchSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: TreeSearchSettings = {
	mySetting: 'defaultValue'
}

export default class TreeSearchPlugin extends Plugin {
	settings: TreeSearchSettings;

	async onload() {
		this.registerView(
			VIEW_TYPE_NAME,
			(leaf) => new TreeSearch(leaf)
		);

		this.addRibbonIcon("search", "Tree Search: Open", () => {
			this.activateView();
		});

		await this.loadSettings();

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

		// new Setting(containerEl)
		// 	.setName('Setting #1')
		// 	.setDesc('It\'s a secret')
		// 	.addText(text => text
		// 		.setPlaceholder('Enter your secret')
		// 		.setValue(this.plugin.settings.mySetting)
		// 		.onChange(async (value) => {
		// 			this.plugin.settings.mySetting = value;
		// 			await this.plugin.saveSettings();
		// 		}));
	}
}
