// Footer under the results: the selected row, its main action (↵) and "Actions" (⌘K), which
// toggles the action panel. Replaces the old row of action buttons on every platform.
import React, {useRef} from "react";
import {useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {Platform} from "obsidian";
import {SearchViewMolecule} from "../react-context/state";
import {ActionsMolecule} from "../react-context/actions";
import {EditorMolecule} from "../editor/EditorMolecule";
import {ActionPanel, Keycaps, truncateMiddle} from "./ActionPanel";
import {CutDrawer} from "./CutDrawer";
import {rowLabel} from "./chain";
import {SHORTCUTS} from "./shortcuts";
import {nodeLabel} from "./timeline-utils";

const keyOf = (id: string) => SHORTCUTS.find(s => s.id === id)?.keys[0]

export const ActionFooter = () => {
    const {selectedNodeAtom, actionPanelAtom, toggleActionPanelAtom, chainAtom, chainWriteAtom, chainPatchRowAtom} = useMolecule(SearchViewMolecule)
    const {reparentChainAtom, commitChainAtom, pushChainAtom} = useMolecule(EditorMolecule)
    const reparentChain = useSetAtom(reparentChainAtom)
    const commitChain = useSetAtom(commitChainAtom)
    const pushChain = useSetAtom(pushChainAtom)
    const chain = useAtomValue(chainAtom)
    const chainWrite = useAtomValue(chainWriteAtom)
    const chainPatchRow = useAtomValue(chainPatchRowAtom)
    const {selectedTreeNodeActionsAtom, executeActionAtom} = useMolecule(ActionsMolecule)
    const selected = useAtomValue(selectedNodeAtom)
    const rowActions = useAtomValue(selectedTreeNodeActionsAtom)
    const panelOpen = useAtomValue(actionPanelAtom) !== null
    const toggle = useSetAtom(toggleActionPanelAtom)
    const execute = useSetAtom(executeActionAtom)
    const dockRef = useRef<HTMLDivElement>(null)

    // Enter runs the row's plain-Enter action. While reparenting (`<`) it moves the chain's row under the selected row;
    // in an append chain (`>`, the modal's Patch mode) it patches the pending write in ("Add" into today's daily note
    // while Quick Add has no row chip), or with none adds the selected row as the next chip (`Patch <row>`).
    const enterAction = rowActions.find(a => a.shortcut?.key === "enter" && a.shortcut.modifiers.length === 0)
    const usable = selected && !selected.archiveRow ? selected : null
    const writeTitle = chain?.mode === "append" && chain.steps.some(s => s.kind === "row") ? "Patch" : "Add"
    const main: {title: string; run: () => void} | null =
        chain?.mode === "reparent" ? usable ? {title: "Move under", run: () => void reparentChain(usable.node)} : null
        : chain?.mode === "append" && chainWrite !== null && !("error" in chainWrite) ? {title: writeTitle, run: () => void commitChain()}
        : chainPatchRow ? {title: `Patch ${rowLabel(chainPatchRow.node)}`, run: () => void pushChain()}
        : enterAction ? {title: enterAction.title, run: () => void execute(enterAction)} : null
    const title = selected ? truncateMiddle(nodeLabel(selected.node), 60) : ""

    return <div ref={dockRef} className="ts-action-dock">
        <ActionPanel dockRef={dockRef}/>
        <CutDrawer/>
        <div className={`ts-action-footer ${Platform.isPhone ? "is-phone" : ""}`}>
            <span className="ts-action-footer-title" title={title}>{title}</span>
            {main && <div role="button" tabIndex={-1} className="ts-action-footer-item ts-action-footer-main"
                          title={main.title} onClick={main.run}>
                <span className="ts-action-footer-label">{main.title}</span>
                <Keycaps k={keyOf("open")}/>
            </div>}
            {main && <span className="ts-action-footer-divider"/>}
            <div role="button" tabIndex={-1} aria-expanded={panelOpen}
                 className={`ts-action-footer-item ${panelOpen ? "is-active" : ""}`}
                 onClick={() => toggle()}>
                <span className="ts-action-footer-label">Actions</span>
                <Keycaps k={keyOf("actions")}/>
            </div>
        </div>
    </div>
}
