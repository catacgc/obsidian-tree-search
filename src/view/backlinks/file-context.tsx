import {ItemView, WorkspaceLeaf} from "obsidian";
import {createRoot, Root} from "react-dom/client";
import {IndexedTree} from "../../indexed-tree";
import {FileContextComponent} from "./FileContextComponent";
import {GraphContextProvider} from "../react-context/GraphContextProvider";

export const FILE_CONTEXT = "file-context";

export class FileContextView extends ItemView {
    root: Root | null = null;
	private readonly index: IndexedTree;

	constructor(leaf: WorkspaceLeaf, index: IndexedTree) {
		super(leaf);
		this.index = index;
	}

	getViewType() {
		return FILE_CONTEXT;
	}

	getDisplayText() {
		return "File Context";
	}

	getIcon() {
		return 'network'
	}

	async onOpen() {
		this.root = createRoot(this.containerEl.children[1]);
		this.root.render(
            <GraphContextProvider app={this.app} index={this.index}>
                <FileContextComponent />
            </GraphContextProvider>
		);
	}

	async onClose() {
		this.root?.unmount();
	}
}
