import {ItemView, WorkspaceLeaf} from "obsidian";
import {createRoot, Root} from "react-dom/client";
import {GraphContextProvider} from "../react-context/GraphContextProvider";
import {createStore} from "jotai";
import {GlobalStore} from "../react-context/global";
import SearchPage from "../SearchPage";
import {ResultNode} from "../../search/search";

export const SEARCH_VIEW = "tree-search";

export class SearchViewPanel extends ItemView {
    root: Root | null = null;

    constructor(leaf: WorkspaceLeaf, private store: GlobalStore) {
        super(leaf);
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
            <GraphContextProvider store={this.store}>
                <SearchPage searchFn={(q: string) => {
                    return [] as ResultNode[];
                }} sectionName="Search"/>
            </GraphContextProvider>
        );
    }

    async onClose() {
        this.root?.unmount();
    }
}
