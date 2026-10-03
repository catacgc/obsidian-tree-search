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
                        <SearchModalContainer kind={this.kind}/>
                    </div>
                </div>
            </GraphContextProvider>
        );

        setTimeout(() => {
            // The "Open editor" command already focused the inline editor.
            if (this.containerEl.querySelector(".ts-inline-editor")) return;
            const inputEl = this.containerEl.querySelector('input');
            inputEl?.click();
            inputEl?.select();
            inputEl?.focus();
        }, 0);

        this.store.set(GlobalAtoms.currentModalAtom, this)
    }

    async onClose() {
        this.store.set(GlobalAtoms.currentModalAtom, null)
        this.root?.unmount();
    }
}
