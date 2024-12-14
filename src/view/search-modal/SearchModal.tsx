import {App, Modal} from "obsidian";
import {IndexedTree} from "../../indexed-tree";
import {createRoot, Root} from "react-dom/client";
import {GraphContextProvider} from "../react-context/GraphContextProvider";
import {SearchModalContainer} from "../search/SearchModalContainer";
import {GraphEvents} from "../obsidian-views/GraphEvents";

export class SearchModal extends Modal {

    root: Root | null = null;

    constructor(app: App, private index: IndexedTree) {
        super(app);

        this.modalEl.addClass("tree-search-modal");
        this.contentEl.addClass("tree-search-modal-content");

        this.root = createRoot(this.contentEl);
        this.root.render(
            <GraphContextProvider index={this.index} app={this.app}>
                <div className="tree-search-modal-container">
                    <div className="workspace-leaf-content">
                        <SearchModalContainer refresh={true}/>
                    </div>
                </div>
            </GraphContextProvider>
        );
    }

    async onOpen() {
        setTimeout(() => {
            const inputEl = this.containerEl.querySelector('input');
            inputEl?.click();
            inputEl?.select();
        }, 0);

        window.addEventListener(GraphEvents.RESULT_SELECTED, () => this.close());
    }

    async onClose() {
        // this.root?.
    }
}
