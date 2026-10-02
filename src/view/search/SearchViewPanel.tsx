import {ItemView, WorkspaceLeaf} from "obsidian";
import {createRoot, Root} from "react-dom/client";
import {GraphContextProvider} from "../react-context/GraphContextProvider";
import {GlobalAtoms, GlobalStore} from "../react-context/global";
import {separatorAtom} from "../react-context/settings";
import SearchPage from "../SearchPage";
import {searchIndex, partitionArchived, parseQuery, extractArchiveReveal} from "@mdtree/core";

export const SEARCH_VIEW = "tree-search";

export class SearchViewPanel extends ItemView {
    root: Root | null = null;

    constructor(leaf: WorkspaceLeaf, private store: GlobalStore) {
        super(leaf);
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
                <SearchPage showSearch={true} searchFn={(q: string) => {
                    // Global search across the whole graph, mirroring the modal
                    // (SearchModalMolecule). Was a stub returning [], so the pane
                    // never showed results once its input became visible.
                    const graph = this.store.get(GlobalAtoms.graphAtom);
                    const separator = this.store.get(separatorAtom);
                    const { reveal } = extractArchiveReveal(parseQuery(q, separator));
                    return partitionArchived(searchIndex(graph, q, separator), reveal).visible;
                }} sectionName="Search" allowTimeline={true} allowEditing={true}/>
            </GraphContextProvider>
        );
    }

    async onClose() {
        this.root?.unmount();
    }
}
