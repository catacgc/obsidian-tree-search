import {Modal} from "obsidian";
import {createRoot, Root} from "react-dom/client";
import {GraphContextProvider} from "../react-context/GraphContextProvider";
import {SearchModalContainer, SearchModalKind} from "../search/SearchModalContainer";
import {GlobalAtoms, GlobalStore} from "../react-context/global";

export class SearchModal extends Modal {

    root: Root | null = null;

    constructor(private store: GlobalStore, private kind: SearchModalKind = "search") {
        super(store.get(GlobalAtoms.appAtom));

        this.modalEl.addClass("tree-search-modal");
        this.contentEl.addClass("tree-search-modal-content");
    }

    async onOpen() {
        this.root = createRoot(this.contentEl);

        this.root?.render(
            <GraphContextProvider store={this.store}>
                <div className="tree-search-modal-container">
                    <div className="workspace-leaf-content">
                        <SearchModalContainer kind={this.kind} onTitle={this.kind === "search" ? t => this.setTitle(t) : undefined}/>
                    </div>
                </div>
            </GraphContextProvider>
        );

        setTimeout(() => {
            const inputEl = this.containerEl.querySelector('input');
            inputEl?.click();
            inputEl?.select();
            inputEl?.focus();
        }, 0);

        this.store.set(GlobalAtoms.currentModalAtom, this)
    }

    async onClose() {
        if (this.store.get(GlobalAtoms.currentModalAtom) === this) this.store.set(GlobalAtoms.currentModalAtom, null)
        this.root?.unmount();
    }
}
