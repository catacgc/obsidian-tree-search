import { App, ItemView, Notice, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import React from "react";
import { buildPullTree } from "@mdtree/core";
import { PullTreeView } from "./PullTreeView";
import { GlobalAtoms, GlobalStore } from "../react-context/global";

export const ORGANISE_VIEW = "organise-notes";

const MAX_DEPTH = 5;

export type OrganiseViewState = { rootKey: string; notePath: string };

function isOrganiseViewState(state: unknown): state is OrganiseViewState {
    return !!state && typeof state === "object"
        && typeof (state as OrganiseViewState).rootKey === "string"
        && typeof (state as OrganiseViewState).notePath === "string";
}

/**
 * Persistent pane for "Pull and organise notes", replacing the old
 * transient preview modal. A single instance is reused across invocations
 * (see `openOrganiseView` in main.ts) and retargeted via `setState` rather
 * than re-instantiated - Obsidian calls `setState` on the existing view
 * when `WorkspaceLeaf.setViewState` targets a leaf that already hosts this
 * view type. The pane does not follow the active file; it stays pinned to
 * whichever note it was last targeted at until retargeted again.
 */
export class OrganiseView extends ItemView {
    root: Root | null = null;
    private viewState: OrganiseViewState | null = null;

    constructor(leaf: WorkspaceLeaf, private store: GlobalStore, private refreshFile: (path: string) => Promise<void>) {
        super(leaf);
    }

    getViewType(): string {
        return ORGANISE_VIEW;
    }

    getDisplayText(): string {
        return this.viewState ? `Organise: ${this.viewState.rootKey}` : "Pull and organise notes";
    }

    getIcon(): string {
        return "list-tree";
    }

    getState(): Record<string, unknown> {
        return this.viewState ?? {};
    }

    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        if (isOrganiseViewState(state)) {
            this.viewState = state;
            this.render();
        }
        await super.setState(state, result);
    }

    async onOpen(): Promise<void> {
        this.render();
    }

    async onClose(): Promise<void> {
        this.root?.unmount();
        this.root = null;
    }

    private render(): void {
        if (!this.viewState) return;
        const { rootKey, notePath } = this.viewState;
        const graph = this.store.get(GlobalAtoms.graphAtom);
        const app = this.store.get(GlobalAtoms.appAtom) as App;

        const pullTree = buildPullTree(graph, rootKey, MAX_DEPTH);
        if (!pullTree) {
            new Notice(`Tree Search: "${rootKey}" was not found in the index`);
            return;
        }

        this.root?.unmount();
        this.root = createRoot(this.contentEl);
        this.root.render(
            <PullTreeView
                app={app}
                graph={graph}
                root={pullTree}
                notePath={notePath}
                onApplied={paths => this.handleApplied(paths)}
            />
        );
    }

    private async handleApplied(touchedPaths: string[]): Promise<void> {
        for (const path of touchedPaths) {
            await this.refreshFile(path);
        }
        this.render();
    }
}
