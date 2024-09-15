import { StrictMode } from "react";
import { ItemView, WorkspaceLeaf } from "obsidian";
import { Root, createRoot } from "react-dom/client";
import { SearchView } from "./search";
import { createContext } from "react";
import { App } from "obsidian";
import { indexTree } from "src/tree-builder";

export const AppContext = createContext<App | undefined>(undefined);

export const VIEW_TYPE_NAME = "tree-search";

export class TreeSearch extends ItemView {
    root: Root | null = null;

    constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE_NAME;
	}

	getDisplayText() {
		return "Tree Search";
	}

	async onOpen() {

		this.root = createRoot(this.containerEl.children[1]);
		this.root.render(
			<StrictMode>
				<AppContext.Provider value={this.app}>
					<SearchView/>
				</AppContext.Provider>
			</StrictMode>,
		);
	}

	async onClose() {
		this.root?.unmount();
	}
}
