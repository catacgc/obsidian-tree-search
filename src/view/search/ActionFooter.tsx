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
import {intentLabel} from "./row-intent";
import {SHORTCUTS} from "./shortcuts";
import {nodeLabel} from "./timeline-utils";

const keyOf = (id: string) => SHORTCUTS.find(s => s.id === id)?.keys[0]

export const ActionFooter = () => {
    const {enterRowAtom, selectEnterRowAtom, selectedNodeAtom, actionPanelAtom, toggleActionPanelAtom, chainAtom, outlineAtom, actualQueryAtom, addFilterAtom,
        allowEditing, newLineSelectedAtom, openAddToAtom, addToLabelAtom} = useMolecule(SearchViewMolecule)
    const {reparentChainAtom} = useMolecule(EditorMolecule)
    const reparentChain = useSetAtom(reparentChainAtom)
    const chain = useAtomValue(chainAtom)
    const outline = useAtomValue(outlineAtom)
    const query = useAtomValue(actualQueryAtom)
    const addFilter = useSetAtom(addFilterAtom)
    const newLineSelected = useAtomValue(newLineSelectedAtom)
    const openAddTo = useSetAtom(openAddToAtom)
    const addToLabel = useAtomValue(addToLabelAtom)
    const {enterRowActionsAtom, enterIntentAtom, executeActionAtom, handleDefaultActionAtom} = useMolecule(ActionsMolecule)
    const intent = useAtomValue(enterIntentAtom)
    const enterRow = useAtomValue(enterRowAtom)
    const selected = useAtomValue(selectedNodeAtom)
    const selectEnterRow = useSetAtom(selectEnterRowAtom)
    const enterActions = useAtomValue(enterRowActionsAtom)
    const panelOpen = useAtomValue(actionPanelAtom) !== null
    const toggle = useSetAtom(toggleActionPanelAtom)
    const execute = useSetAtom(executeActionAtom)
    const openDefault = useSetAtom(handleDefaultActionAtom)
    const dockRef = useRef<HTMLDivElement>(null)

    // Enter acts on the selected row, else the first row (enterRowAtom), mirroring openRowAtom: the New line row
    // `Add to <root>`; while reparenting (`<`) it moves the chain's row under that row; in the outline editor typed
    // text with no row picked becomes a filter crumb (`Filter`). Otherwise the row's rowIntent (enterIntentAtom) names
    // it, and a row without one shows its plain-Enter action.
    const enterAction = enterActions.find(a => a.shortcut?.key === "enter" && a.shortcut.modifiers.length === 0)
    const usable = enterRow && !enterRow.archiveRow ? enterRow : null
    const intentTitle = usable && intent ? intentLabel(intent, usable.node) : null
    // Nothing selected (and no filter text typed in the outline editor): Enter is Add to (handleDefaultActionAtom).
    const addsTo = allowEditing && chain === null && !selected && !newLineSelected
    const main: {title: string; run: () => void} | null =
        chain?.mode === "reparent" ? usable ? {title: "Move under", run: () => void reparentChain(usable.node)} : null
        : newLineSelected ? {title: addToLabel, run: () => openAddTo()}
        : outline && query.trim() !== "" && (!selected || selected.archiveRow) ? {title: "Filter", run: () => addFilter()}
        : addsTo ? {title: addToLabel, run: () => void openDefault()}
        : intentTitle ? {title: intentTitle, run: () => void openDefault()}
        : enterAction ? {title: enterAction.title, run: () => { selectEnterRow(); void execute(enterAction) }} : null
    const title = newLineSelected ? `${addToLabel}…` : addsTo ? "" : enterRow ? truncateMiddle(nodeLabel(enterRow.node), 60) : ""

    return <div ref={dockRef} className="ts-action-dock">
        <ActionPanel dockRef={dockRef}/>
        {outline && <NoteBodyPane/>}
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
