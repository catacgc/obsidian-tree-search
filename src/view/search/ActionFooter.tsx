// Footer under the results: the selected row, its main action (↵) and "Actions" (⌘K), which
// toggles the action panel. Replaces the old row of action buttons on every platform.
import React, {useRef} from "react";
import {useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {Platform} from "obsidian";
import {SearchViewMolecule} from "../react-context/state";
import {ActionsMolecule} from "../react-context/actions";
import {ActionPanel, Keycaps, truncateMiddle} from "./ActionPanel";
import {SHORTCUTS} from "./shortcuts";
import {nodeLabel} from "./timeline-utils";
import {appendTargetAt} from "../editor/row-editing";

const keyOf = (id: string) => SHORTCUTS.find(s => s.id === id)?.keys[0]

export const ActionFooter = () => {
    const {
        selectedNodeAtom, actionPanelAtom, toggleActionPanelAtom,
        isQuickAdd, renderableTreeNodesAtom, selectedLineAtom, timelineActiveAtom,
    } = useMolecule(SearchViewMolecule)
    const {selectedTreeNodeActionsAtom, executeActionAtom, handleDefaultActionAtom} = useMolecule(ActionsMolecule)
    const selected = useAtomValue(selectedNodeAtom)
    const rowActions = useAtomValue(selectedTreeNodeActionsAtom)
    const rows = useAtomValue(renderableTreeNodesAtom)
    const selectedLine = useAtomValue(selectedLineAtom)
    const timelineActive = useAtomValue(timelineActiveAtom)
    const panelOpen = useAtomValue(actionPanelAtom) !== null
    const toggle = useSetAtom(toggleActionPanelAtom)
    const execute = useSetAtom(executeActionAtom)
    const handleDefault = useSetAtom(handleDefaultActionAtom)
    const dockRef = useRef<HTMLDivElement>(null)

    // Quick Add: Enter appends to the selected row's page; elsewhere it runs the plain-Enter row action.
    const pos = rows.findIndex(r => r.index === selectedLine)
    const appendTarget = isQuickAdd && pos >= 0 ? appendTargetAt(rows, pos, timelineActive) : null
    const enterAction = isQuickAdd ? undefined : rowActions.find(a => a.shortcut?.key === "enter" && a.shortcut.modifiers.length === 0)
    const main: {title: string; run: () => void} | null = isQuickAdd
        ? appendTarget && {title: `Append to [[${appendTarget.parentName}]]`, run: () => void handleDefault()}
        : enterAction ? {title: enterAction.title, run: () => void execute(enterAction)} : null
    const title = selected ? truncateMiddle(nodeLabel(selected.node), 60) : ""

    return <div ref={dockRef} className="ts-action-dock">
        <ActionPanel dockRef={dockRef}/>
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
