import {StrictMode} from "react";
import {ItemView, WorkspaceLeaf} from "obsidian";
import {createRoot, Root} from "react-dom/client";
import {AppContext} from "./AppContext";
import {GraphComponent} from "./GraphComponent";
import {IndexedTree} from "../indexed-tree";

export const VIEW_TYPE_NAME = "tree-search";

export class TreeSearch extends ItemView {
    root: Root | null = null;
	private readonly index: IndexedTree;

	constructor(leaf: WorkspaceLeaf, index: IndexedTree) {
		super(leaf);
		this.index = index;
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
					<GraphComponent index={this.index} />
				</AppContext.Provider>
			</StrictMode>,
		);
	}

	async onClose() {
		this.root?.unmount();
	}
}
