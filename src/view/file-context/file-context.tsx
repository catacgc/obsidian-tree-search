import {ItemView, WorkspaceLeaf} from "obsidian";
import {createRoot, Root} from "react-dom/client";
import {IndexedTree} from "../../indexed-tree";
import {activeFileAtom, FileContextComponent, pinAtom} from "./FileContextComponent";
import {GraphContextProvider} from "../react-context/GraphContextProvider";
import { ScopeProvider } from "jotai-scope";

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
            <GraphContextProvider app={this.app}>
				<ScopeProvider atoms={[pinAtom, activeFileAtom]} debugName="FileContext">
                	<FileContextComponent />
				</ScopeProvider>
            </GraphContextProvider>
		);
	}

	async onClose() {
		this.root?.unmount();
	}
}
