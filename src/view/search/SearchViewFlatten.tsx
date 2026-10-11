import {useAtom, useAtomValue, useSetAtom} from "jotai";
import {type BlockLine, ParsedNode} from "@mdtree/core";
import {useMolecule} from "bunshi/react";
import {Platform} from "obsidian";
import {SearchViewMolecule} from "../react-context/state";
import {GlobalAtoms} from "../react-context/global";
import {SearchTreeNode} from "../SearchTreeNode";
import {SearchBar} from "./SearchBar";
import {ActionFooter} from "./ActionFooter";
import {SearchHelp} from "./SearchHelp";
import {RecencyFilterBar, TimelineRow} from "./SearchTimeline";
import React, {useEffect, useMemo, useState} from "react";
import {EditorMolecule} from "../editor/EditorMolecule";
import {InlineEditor} from "../editor/InlineEditor";
import {appendTargetAt, isEditableRow, type AppendTarget} from "../editor/row-editing";
import {BlockMoreFooter} from "./BlockMore";
import {ChainPreview} from "./ChainPreview";

export type TreeNode = {
    node: ParsedNode,
    indent: number,
    hasChildren: boolean
    visible: boolean
    selected: boolean
    index: number
    matched: boolean
    archived?: boolean
    /** Hidden only because its list is compacted; a "+N more" footer reveals it. */
    compacted?: boolean
    archiveRow?: boolean
    timeline?: { breadcrumb: ParsedNode[]; pinned: boolean; ageDays: number; block?: BlockLine[] }
    /** Timeline block row showing all its lines, not only the previews ("+N more" or → in the search input). */
    blockOpen?: boolean
    /** Tree row shown under one of its inline parents (a note its line links): its outline parent, shown as a subtitle. */
    outlineParent?: ParsedNode
}

/** The Search modal's / pane's body: the inline editor while this view hosts it (`>`, ⊕, Alt+A/N, Alt-Edit…), else
 *  the search with its results. */
export const SearchViewFlatten = () => {
    const {editorOpenAtom, leaveEditorAtom, scopeName, allowEditing} = useMolecule(SearchViewMolecule)
    const {editorStateAtom} = useMolecule(EditorMolecule)
    const editorOpen = useAtomValue(editorOpenAtom)
    const state = useAtomValue(editorStateAtom)
    const leaveEditor = useSetAtom(leaveEditorAtom)
    const setHost = useSetAtom(GlobalAtoms.editorHostAtom)
    // Another view or Quick Add took the editor: back to this view's search, without stealing focus.
    useEffect(() => { if (!editorOpen) leaveEditor({saved: null, focus: false}) }, [editorOpen])
    // Closing the modal or pane while it shows the editor frees it; the draft stays.
    useEffect(() => () => { if (allowEditing) setHost(h => h === scopeName.name ? null : h) }, [])
    if (editorOpen) return state ? <InlineEditor key={state.sessionId} state={state}/> : null
    return <SearchResultsView/>
}

const SearchResultsView = () => {
    const {searchViewStateAtom, incrementPagesAtom, timelineActiveAtom, recencyWindowAtom, rebuildResultsAtom, actualQueryAtom,
        allowEditing, allowTimeline, hoveredLineAtom, selectedLineAtom, flashLineAtom, blockFootersAtom, chainAtom} = useMolecule(SearchViewMolecule)
    const {altHeldAtom, ownPathAtom} = useMolecule(EditorMolecule)
    const chainActive = useAtomValue(chainAtom) !== null

    const viewState = useAtomValue(searchViewStateAtom)
    const incrementPages = useSetAtom(incrementPagesAtom)
    const timelineActive = useAtomValue(timelineActiveAtom)
    const recencyWindow = useAtomValue(recencyWindowAtom)
    const actualQuery = useAtomValue(actualQueryAtom)
    const rebuild = useSetAtom(rebuildResultsAtom)
    const [flashLine, setFlashLine] = useAtom(flashLineAtom)
    const [altHeld, setAltHeld] = useAtom(altHeldAtom)
    const hovered = useAtomValue(hoveredLineAtom)
    const selected = useAtomValue(selectedLineAtom)
    const ownPath = useAtomValue(ownPathAtom)
    const footers = useAtomValue(blockFootersAtom)
    const [pointerInList, setPointerInList] = useState(false)

    // Re-project the stored results when the mode (possibly flipped from another
    // open view) or the recency window changes; idempotent on mount.
    useEffect(() => { rebuild() }, [timelineActive, recencyWindow])

    // A selection that flashes (the row a save just wrote) stops flashing after the animation.
    useEffect(() => {
        if (flashLine === null) return
        const timer = window.setTimeout(() => setFlashLine(null), 1500)
        return () => window.clearTimeout(timer)
    }, [flashLine])

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
        {/* tw-reset (Tailwind preflight) strips list and link styles, so the chain preview's rendered markdown stays outside it. */}
        {(viewState.showSearch) && <div className="ts-search-block">
                <div className="tw-reset"><SearchBar isQuickLink={viewState.isQuickLink}/></div>
                <ChainPreview/>
                {allowTimeline && <div className="tw-reset"><RecencyFilterBar/></div>}
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
                actualQuery.trim().length >= 3 && (timelineActive || recencyWindow !== "all")
                    ? <div className="ts-timeline-empty">No {timelineActive ? "dated " : ""}matches{recencyWindow !== "all" ? ` in the last ${recencyWindow}` : ""}</div>
                    // Only the main search modal shows the syntax cheat sheet (not while a `>` / `<` chain
                    // replaces the search); auxiliary panes (file context, parents, tasks, inline results) stay blank.
                    : viewState.isModal && !chainActive ? <SearchHelp /> : null
            ) : (
                <>
                    {rows.map((tree, index) => timelineActive
                        ? <TimelineRow node={tree} key={`${index}`} {...rowProps(tree, index)}/>
                        : <React.Fragment key={`${index}`}>
                            <SearchTreeNode node={tree} {...rowProps(tree, index)}/>
                            {(footers.get(tree.index) ?? []).map((f, j) => <BlockMoreFooter key={j} footer={f}/>)}
                        </React.Fragment>
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
