// What each search-view shortcut does. Shared by KeyComboWrapper (keyboard) and the action
// panel (click / ↵ on an item), so both run the same code for the same action.
import {useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {GlobalAppMolecule, SearchViewMolecule, RECENCY_WINDOWS} from "../react-context/state";
import {ActionsMolecule} from "../react-context/actions";
import {EditorMolecule} from "../editor/EditorMolecule";
import type {ShortcutId} from "./shortcuts";

export type ShortcutHandlers = Record<ShortcutId, (keyIndex: number) => unknown>

export function useShortcutHandlers(): ShortcutHandlers {
    const {
        arrowDownAtom, arrowUpAtom, timelineActiveAtom, toggleViewModeAtom, recencyWindowAtom,
        incExpandAtom, decExpandAtom, resetCollapseAtom, toggleActionPanelAtom, startReparentAtom, openOutlineAtom, toggleCutAtom,
    } = useMolecule(SearchViewMolecule)
    const startReparent = useSetAtom(startReparentAtom)
    const toggleCut = useSetAtom(toggleCutAtom)
    const openOutline = useSetAtom(openOutlineAtom)
    const {isGraphLoadingAtom} = useMolecule(GlobalAppMolecule)
    const {editAtom, openAppendForSelectedAtom} = useMolecule(EditorMolecule)
    const {copyActionAtom, handleDefaultActionAtom, highlightSelectedItemAtom, runRaycastActionAtom} = useMolecule(ActionsMolecule)

    const timelineActive = useAtomValue(timelineActiveAtom)
    const arrowUp = useSetAtom(arrowUpAtom)
    const arrowDown = useSetAtom(arrowDownAtom)
    const toggleViewMode = useSetAtom(toggleViewModeAtom)
    const setRecencyWindow = useSetAtom(recencyWindowAtom)
    const incExpand = useSetAtom(incExpandAtom)
    const decExpand = useSetAtom(decExpandAtom)
    const resetCollapse = useSetAtom(resetCollapseAtom)
    const toggleActionPanel = useSetAtom(toggleActionPanelAtom)
    const setGraphLoading = useSetAtom(isGraphLoadingAtom)
    const handleDefaultAction = useSetAtom(handleDefaultActionAtom)
    const highlightSelectedItem = useSetAtom(highlightSelectedItemAtom)
    const copyAction = useSetAtom(copyActionAtom)
    const runRaycastAction = useSetAtom(runRaycastActionAtom)
    const edit = useSetAtom(editAtom)
    const openAppendForSelected = useSetAtom(openAppendForSelectedAtom)

    return {
        next: () => arrowDown(),
        previous: () => arrowUp(),
        open: () => handleDefaultAction(),
        reveal: () => highlightSelectedItem(),
        actions: () => toggleActionPanel(),
        toggleView: () => toggleViewMode(),
        recency: i => setRecencyWindow(RECENCY_WINDOWS[i]),
        expand: () => { if (!timelineActive) incExpand() },
        collapse: () => { if (!timelineActive) decExpand() },
        collapseAll: () => { if (!timelineActive) resetCollapse() },
        refresh: () => setGraphLoading(true),
        copy: () => copyAction(),
        insertAfter: () => runRaycastAction(["insert"]),
        moveUnder: () => startReparent(),
        cut: () => toggleCut(),
        archive: () => runRaycastAction(["archive", "unarchive", "archivePage", "unarchivePage"]),
        consolidate: () => runRaycastAction(["pullChildren"]),
        append: () => openAppendForSelected(),
        edit: () => edit(),
        quickAdd: () => openOutline({kind: "today", quickAdd: true}),
    }
}
