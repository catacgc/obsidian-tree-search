import {ItemView, WorkspaceLeaf} from "obsidian";
import {createRoot, Root} from "react-dom/client";
import {FileContextComponent} from "./FileContextComponent";
import {GraphContextProvider} from "../react-context/GraphContextProvider";
import {GlobalStore} from "../react-context/global";
import {resetDefaultInjector} from "bunshi";

export const FILE_CONTEXT = "file-context";

export class FileContextView extends ItemView {
    root: Root | null = null;

	constructor(leaf: WorkspaceLeaf, private store: GlobalStore) {
		super(leaf);
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

    async onload() {
        this.root?.unmount();
        this.root = createRoot(this.containerEl.children[1]);
        this.root?.render(
            <GraphContextProvider store={this.store}>
                <FileContextComponent />
            </GraphContextProvider>
        );
    }

	async onOpen() {
		// this.root?.render(
        //     <GraphContextProvider store={this.store}>
        //         <FileContextComponent />
        //     </GraphContextProvider>
		// );
	}

	async onClose() {
		this.root?.unmount();
        resetDefaultInjector()
	}
}
