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
import {NoteBodyPane} from "./NoteBodyPane";
import {isPatchable, rowLabel} from "./chain";
import {SHORTCUTS} from "./shortcuts";
import {nodeLabel} from "./timeline-utils";

const keyOf = (id: string) => SHORTCUTS.find(s => s.id === id)?.keys[0]

export const ActionFooter = () => {
    const {enterRowAtom, selectEnterRowAtom, actionPanelAtom, toggleActionPanelAtom, chainAtom, chainWriteAtom, chainPatchRowAtom, allowEditing} = useMolecule(SearchViewMolecule)
    const {reparentChainAtom, commitChainAtom, pushChainAtom} = useMolecule(EditorMolecule)
    const reparentChain = useSetAtom(reparentChainAtom)
    const commitChain = useSetAtom(commitChainAtom)
    const pushChain = useSetAtom(pushChainAtom)
    const chain = useAtomValue(chainAtom)
    const chainWrite = useAtomValue(chainWriteAtom)
    const chainPatchRow = useAtomValue(chainPatchRowAtom)
    const {enterRowActionsAtom, executeActionAtom, handleDefaultActionAtom} = useMolecule(ActionsMolecule)
    const enterRow = useAtomValue(enterRowAtom)
    const selectEnterRow = useSetAtom(selectEnterRowAtom)
    const enterActions = useAtomValue(enterRowActionsAtom)
    const panelOpen = useAtomValue(actionPanelAtom) !== null
    const toggle = useSetAtom(toggleActionPanelAtom)
    const execute = useSetAtom(executeActionAtom)
    const openDefault = useSetAtom(handleDefaultActionAtom)
    const dockRef = useRef<HTMLDivElement>(null)

    // Enter acts on the selected row, else the first row (enterRowAtom): in views with editor mode a page, header or
    // line opens in its Patch view (`Open <row>`), any other row runs its plain-Enter action. While reparenting (`<`) it
    // moves the chain's row under that row; in an append chain (`>`, the modal's Patch mode) it patches the pending
    // write in ("Add" into today's daily note while Quick Add has no row chip), or with none adds that row as the next
    // chip (`Patch <row>`).
    const enterAction = enterActions.find(a => a.shortcut?.key === "enter" && a.shortcut.modifiers.length === 0)
    const usable = enterRow && !enterRow.archiveRow ? enterRow : null
    const writeTitle = chain?.mode === "append" && chain.steps.some(s => s.kind === "row") ? "Patch" : "Add"
    const main: {title: string; run: () => void} | null =
        chain?.mode === "reparent" ? usable ? {title: "Move under", run: () => void reparentChain(usable.node)} : null
        : chain?.mode === "append" && chainWrite !== null && !("error" in chainWrite) ? {title: writeTitle, run: () => void commitChain()}
        : chainPatchRow ? {title: `Patch ${rowLabel(chainPatchRow.node)}`, run: () => { selectEnterRow(); void pushChain() }}
        : allowEditing && chain === null && usable && isPatchable(usable.node) ? {title: `Open ${rowLabel(usable.node)}`, run: () => void openDefault()}
        : enterAction ? {title: enterAction.title, run: () => { selectEnterRow(); void execute(enterAction) }} : null
    const title = enterRow ? truncateMiddle(nodeLabel(enterRow.node), 60) : ""

    return <div ref={dockRef} className="ts-action-dock">
        <ActionPanel dockRef={dockRef}/>
        <NoteBodyPane/>
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
