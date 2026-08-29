import { App, Modal, Notice } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import React from "react";
import { NotesGraph, buildPullTree } from "@mdtree/core";
import { PullTreeView } from "./PullTreeView";

const MAX_DEPTH = 5;

export class PullPreviewModal extends Modal {
    root: Root | null = null;

    constructor(
        app: App,
        private graph: NotesGraph,
        private rootKey: string,
        private destinationPath: string,
    ) {
        super(app);
        this.modalEl.addClass("tree-search-modal");
    }

    onOpen(): void {
        const pullTree = buildPullTree(this.graph, this.rootKey, MAX_DEPTH);
        if (!pullTree) {
            new Notice(`Tree Search: "${this.rootKey}" was not found in the index`);
            this.close();
            return;
        }

        this.setTitle("Pull children into this note");
        this.root = createRoot(this.contentEl);
        this.root.render(
            <PullTreeView
                app={this.app}
                graph={this.graph}
                root={pullTree}
                destinationPath={this.destinationPath}
                onDone={() => this.close()}
            />
        );
    }

    onClose(): void {
        this.root?.unmount();
        this.root = null;
    }
}
