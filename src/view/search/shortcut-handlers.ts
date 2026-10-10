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
        incExpandAtom, decExpandAtom, resetCollapseAtom, toggleActionPanelAtom, startReparentAtom,
    } = useMolecule(SearchViewMolecule)
    const startReparent = useSetAtom(startReparentAtom)
    const {isGraphLoadingAtom} = useMolecule(GlobalAppMolecule)
    const {openEditForSelectedAtom, openAppendForSelectedAtom, openBlankEditorAtom} = useMolecule(EditorMolecule)
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
    const openEditForSelected = useSetAtom(openEditForSelectedAtom)
    const openAppendForSelected = useSetAtom(openAppendForSelectedAtom)
    const openBlankEditor = useSetAtom(openBlankEditorAtom)

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
        moveTo: () => startReparent(),
        archive: () => runRaycastAction(["archive", "unarchive", "archivePage", "unarchivePage"]),
        consolidate: () => runRaycastAction(["pullChildren"]),
        append: () => openAppendForSelected(),
        edit: () => openEditForSelected(),
        newEditor: () => openBlankEditor(),
    }
}
