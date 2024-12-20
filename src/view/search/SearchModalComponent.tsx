import {ItemView, WorkspaceLeaf} from "obsidian";
import {createRoot, Root} from "react-dom/client";
import {IndexedTree} from "../../indexed-tree";
import {GraphContextProvider} from "../react-context/GraphContextProvider";
import {SearchModalContainer} from "./SearchModalContainer";
import { createStore, Provider } from "jotai";

export const SEARCH_VIEW = "tree-search";

export class SearchModalComponent extends ItemView {
    root: Root | null = null;
    private readonly index: IndexedTree;
    private readonly store: ReturnType<typeof createStore>

    constructor(leaf: WorkspaceLeaf, index: IndexedTree) {
        super(leaf);
        this.index = index;
        this.store = createStore()
    }

    getViewType() {
        return SEARCH_VIEW;
    }

    getIcon() {
        return 'list-tree'
    }

    getDisplayText() {
        return "Tree Search";
    }

    async onOpen() {
        this.root = createRoot(this.containerEl.children[1]);
        this.root.render(
            <GraphContextProvider app={this.app}>
                <Provider store={this.store}>
                    <SearchModalContainer refresh={true}/>
                </Provider>
            </GraphContextProvider>
        );
    }

    async onClose() {
        this.root?.unmount();
    }
}
