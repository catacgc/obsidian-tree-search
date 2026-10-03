import {useAtom, useAtomValue, useSetAtom} from "jotai";
import {ParsedNode} from "@mdtree/core";
import {useMolecule} from "bunshi/react";
import {Platform} from "obsidian";
import {SearchViewMolecule} from "../react-context/state";
import {SearchTreeNode} from "../SearchTreeNode";
import {SearchBar} from "./SearchBar";
import {ActionFooter} from "./ActionFooter";
import {SearchHelp} from "./SearchHelp";
import {TimelineFilterBar, TimelineRow} from "./SearchTimeline";
import React, {useEffect, useMemo, useState} from "react";
import {EditorMolecule} from "../editor/EditorMolecule";
import {InlineEditor} from "../editor/InlineEditor";
import {appendTargetAt, isEditableRow, type AppendTarget} from "../editor/row-editing";
import {GlobalAtoms} from "../react-context/global";

export type TreeNode = {
    node: ParsedNode,
    indent: number,
    hasChildren: boolean
    visible: boolean
    selected: boolean
    index: number
    matched: boolean
    archived?: boolean
    archiveRow?: boolean
    timeline?: { breadcrumb: ParsedNode[]; pinned: boolean; ageDays: number }
}

export const SearchViewFlatten = () => {
    const {searchViewStateAtom, incrementPagesAtom, timelineActiveAtom, timelineWindowAtom, rebuildResultsAtom, actualQueryAtom,
        allowEditing, hoveredLineAtom, selectedLineAtom} = useMolecule(SearchViewMolecule)
    const {editorStateAtom, altHeldAtom, ownPathAtom, openBlankEditorAtom} = useMolecule(EditorMolecule)

    const viewState = useAtomValue(searchViewStateAtom)
    const incrementPages = useSetAtom(incrementPagesAtom)
    const timelineActive = useAtomValue(timelineActiveAtom)
    const timelineWindow = useAtomValue(timelineWindowAtom)
    const actualQuery = useAtomValue(actualQueryAtom)
    const rebuild = useSetAtom(rebuildResultsAtom)
    const editorState = useAtomValue(editorStateAtom)
    const [altHeld, setAltHeld] = useAtom(altHeldAtom)
    const hovered = useAtomValue(hoveredLineAtom)
    const selected = useAtomValue(selectedLineAtom)
    const ownPath = useAtomValue(ownPathAtom)
    const [pointerInList, setPointerInList] = useState(false)
    const [editorRequest, setEditorRequest] = useAtom(GlobalAtoms.editorRequestAtom)
    const openBlank = useSetAtom(openBlankEditorAtom)

    // Re-project the stored results when the mode (possibly flipped from another
    // open view) or the recency window changes; idempotent on mount.
    useEffect(() => { rebuild() }, [timelineActive, timelineWindow])

    // The "Open editor" command opens the Search modal and requests a blank editor there.
    useEffect(() => {
        if (!editorRequest || !allowEditing || !viewState.isModal) return
        setEditorRequest(false)
        void openBlank()
    }, [editorRequest, allowEditing])

    // Alt/Option state drives the edit hint; reset on blur so it never sticks.
    useEffect(() => {
        if (!allowEditing) return
        const onKey = (ev: KeyboardEvent) => setAltHeld(ev.altKey)
        const onBlur = () => setAltHeld(false)
        window.addEventListener("keydown", onKey)
        window.addEventListener("keyup", onKey)
        window.addEventListener("blur", onBlur)
        return () => {
            window.removeEventListener("keydown", onKey)
            window.removeEventListener("keyup", onKey)
            window.removeEventListener("blur", onBlur)
        }
    }, [allowEditing])

    const rows = viewState.searchResults.renderableNodes

    // Append dot for the hovered group (desktop only: touch has no hover; mobile uses the action panel)
    // and the edit-hint row.
    const decorations = useMemo(() => {
        if (!allowEditing) return null
        const hoveredPos = rows.findIndex(r => r.index === hovered)
        const selectedPos = rows.findIndex(r => r.index === selected)
        const dots = new Map<number, AppendTarget>()
        if (!Platform.isMobile && pointerInList && hoveredPos >= 0) {
            const target = appendTargetAt(rows, hoveredPos, timelineActive)
            if (target) dots.set(target.dotPos, target)
        }
        const editHintPos = altHeld ? (pointerInList ? hoveredPos : selectedPos) : -1
        return {dots, editHintPos}
    }, [allowEditing, rows, hovered, selected, pointerInList, altHeld, timelineActive])

    const rowProps = (row: TreeNode, pos: number) => {
        if (!decorations) return {pos}
        const editable = isEditableRow(row, ownPath, timelineActive)
        return {pos, editable, appendDot: decorations.dots.get(pos), editHint: pos === decorations.editHintPos && editable}
    }

    return <>
        {allowEditing && editorState && <InlineEditor key={editorState.sessionId} state={editorState}/>}
        {(viewState.showSearch) && <div className="tw-reset ts-search-block">
                <SearchBar isQuickLink={viewState.isQuickLink}/>
                {timelineActive && <TimelineFilterBar/>}
            </div>
        }

        <div className="flex-1 overflow-y-auto"
             onMouseEnter={() => setPointerInList(true)}
             onMouseLeave={() => setPointerInList(false)}
             onMouseMove={allowEditing ? (ev => { if (ev.altKey !== altHeld) setAltHeld(ev.altKey) }) : undefined}
        >
            {viewState.isLoading ? (
                <LoadingDots />
            ) : viewState.searchResults.renderableNodes.length === 0 ? (
                timelineActive && actualQuery.trim().length >= 3
                    ? <div className="ts-timeline-empty">No dated matches{timelineWindow !== "all" ? ` in the last ${timelineWindow}` : ""}</div>
                    // Only the main search modal shows the syntax cheat sheet; auxiliary
                    // panes (file context, parents, tasks, inline results) stay blank.
                    : viewState.isModal ? <SearchHelp /> : null
            ) : (
                <>
                    {rows.map((tree, index) => timelineActive
                        ? <TimelineRow node={tree} key={`${index}`} {...rowProps(tree, index)}/>
                        : <SearchTreeNode node={tree} key={`${index}`} {...rowProps(tree, index)}/>
                    )}
                    {viewState.searchResults.hasMore && (
                        <div className="flex justify-center items-center py-4">
                            <button
                                onClick={incrementPages}
                                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors duration-200"
                            >
                                Load More
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>

        {viewState.showSearch && <ActionFooter/>}
    </>
};

const LoadingDots = () => {
    return <div className="flex justify-center items-center space-x-1 text-6xl font-bold text-gray-600 dark:text-gray-300">
        <span className="animate-bounce [animation-delay:-0.3s]">.</span>
        <span className="animate-bounce [animation-delay:-0.15s]">.</span>
        <span className="animate-bounce">.</span>
    </div>
}
