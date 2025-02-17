import {App, ItemView, Modal, Platform, WorkspaceLeaf} from "obsidian";
import {createRoot, Root} from "react-dom/client";
import {IndexedTree} from "../../../indexed-tree";
import {GraphContextProvider} from "../../react-context/GraphContextProvider";
import {SearchModalContainer} from "../../search/SearchModalContainer";
import { createStore, Provider } from "jotai";
import React from "react";
import { GraphEvents } from "src/view/obsidian-views/GraphEvents";

export class QuickLinkModal extends Modal {
    root: Root | null = null;

    constructor(app: App, private index: IndexedTree) {
        super(app);

        this.modalEl.addClass("tree-search-modal");
        this.contentEl.addClass("tree-search-modal-content");
    }

    async onOpen() {
        this.root = createRoot(this.contentEl);
        this.root.render(
            <GraphContextProvider app={this.app}>
                <div className="tree-search-modal-container">
                    <div className="workspace-leaf-content">
                        <SearchModalContainer refresh={false} isQuickLink={true} />
                    </div>
                </div>
            </GraphContextProvider>
        );

        setTimeout(() => {
            const inputEl = this.containerEl.querySelector('input');
            inputEl?.click();
            inputEl?.select();
        }, 0);

        window.addEventListener(GraphEvents.RESULT_SELECTED, () => this.close());
    }

    async onClose() {
        this.root?.unmount();
        window.removeEventListener(GraphEvents.RESULT_SELECTED, () => this.close());
    }
}
