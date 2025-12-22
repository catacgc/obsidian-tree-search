import { Modal } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import { GraphContextProvider } from "../../react-context/GraphContextProvider";
import { SearchModalContainer } from "../SearchModalContainer";
import React from "react";
import { getDefaultStore } from "jotai";
import { getDefaultInjector } from "bunshi";
import { GlobalAppMolecule } from "../../react-context/global";

export class QuickLinkModal extends Modal {
    root: Root | null = null;

    constructor(private store: ReturnType<typeof getDefaultStore>) {
        const { appAtom } = getDefaultInjector().get(GlobalAppMolecule)
        super(store.get(appAtom));

        this.modalEl.addClass("tree-search-modal");
        this.contentEl.addClass("tree-search-modal-content");
    }

    async onOpen() {
        this.root = createRoot(this.contentEl);
        this.root.render(
            <GraphContextProvider store={this.store}>
                <div className="tree-search-modal-container">
                    <div className="workspace-leaf-content">
                        <SearchModalContainer isQuickLink={true} />
                    </div>
                </div>
            </GraphContextProvider>
        );

        setTimeout(() => {
            const inputEl = this.containerEl.querySelector('input');
            inputEl?.click();
            inputEl?.select();
        }, 0);

        this.store.set(getDefaultInjector().get(GlobalAppMolecule).currentModalAtom, this)

    }

    async onClose() {
        this.root?.unmount();

        this.store.set(getDefaultInjector().get(GlobalAppMolecule).currentModalAtom, null)
    }
}
