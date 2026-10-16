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
import React, {useEffect, useMemo, useRef, useState} from "react";
import {EditorMolecule} from "../editor/EditorMolecule";
import {InlineEditor} from "../editor/InlineEditor";
import {isEditableRow} from "../editor/row-editing";
import {isPatchable} from "./chain";
import {BlockMoreFooter} from "./BlockMore";
import {editedRowPos, LineEditor} from "./LineEditor";

export type TreeNode = {
    node: ParsedNode,
    indent: number,
    hasChildren: boolean
    visible: boolean
    selected: boolean
    index: number
    matched: boolean
    archived?: boolean
    /** Listed in the outline editor only because it is pinned (edited or added there): the filter would hide it. */
    miss?: boolean
    /** Hidden only because its list is compacted; a "+N more" footer reveals it. */
    compacted?: boolean
    archiveRow?: boolean
    timeline?: { breadcrumb: ParsedNode[]; pinned: boolean; ageDays: number; block?: BlockLine[] }
    /** Timeline block row showing all its lines, not only the previews ("+N more" or → in the search input). */
    blockOpen?: boolean
    /** Tree row: its outline parent, shown as a subtitle, when it is top-level or shown under one of its inline parents (a note its line links). */
    outlineParent?: ParsedNode
}

/** The Search modal's / pane's body: the inline editor while this view hosts it (Alt+A, prose, Rename, filters),
 *  else the search with its results (in the outline editor: its rows, the line editor and the New line row). */
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
        allowEditing, allowTimeline, hoveredLineAtom, selectedLineAtom, flashLineAtom, blockFootersAtom, chainAtom,
        outlineAtom, lineEditAtom, paneAtom, paneRefAtom, openAddToAtom, addToLabelAtom, newLineShownAtom, focusSearchInputAtom, newLineSelectedAtom} = useMolecule(SearchViewMolecule)
    const {altHeldAtom, ownPathAtom} = useMolecule(EditorMolecule)
    const chainActive = useAtomValue(chainAtom) !== null
    const outline = useAtomValue(outlineAtom)
    const lineEdit = useAtomValue(lineEditAtom)
    const pane = useAtomValue(paneAtom)
    const paneRef = useAtomValue(paneRefAtom)
    const openAddTo = useSetAtom(openAddToAtom)
    const addToLabel = useAtomValue(addToLabelAtom)
    const newLineShown = useAtomValue(newLineShownAtom)
    const newLineSelected = useAtomValue(newLineSelectedAtom)
    const focusSearch = useSetAtom(focusSearchInputAtom)

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
    /** The edited row's position: the line editor replaces it (-1: the New line, or a row not shown). */
    const editPos = outline ? editedRowPos(rows, lineEdit) : -1
    /** The expanded content pane fills the view: the rows are hidden. */
    const paneFills = outline !== null && pane.size === "expanded" && paneRef !== null && paneRef.key !== pane.closedKey

    // A line editor that closes hands the keys back to the search input.
    const lineEditId = lineEdit?.id ?? null
    const prevLineEditId = useRef(lineEditId)
    useEffect(() => {
        if (prevLineEditId.current !== null && lineEditId === null && outline) focusSearch(n => n + 1)
        prevLineEditId.current = lineEditId
    }, [lineEditId])

    // Patch dot under the hovered page, heading or line (desktop only: touch has no hover; mobile uses the action
    // panel) and the edit-hint row.
    const decorations = useMemo(() => {
        if (!allowEditing) return null
        const hoveredPos = rows.findIndex(r => r.index === hovered)
        const selectedPos = rows.findIndex(r => r.index === selected)
        const hoveredRow = rows[hoveredPos]
        const dotPos = !Platform.isMobile && pointerInList && hoveredRow && !hoveredRow.archiveRow && isPatchable(hoveredRow.node) ? hoveredPos : -1
        const editHintPos = altHeld ? (pointerInList ? hoveredPos : selectedPos) : -1
        return {dotPos, editHintPos}
    }, [allowEditing, rows, hovered, selected, pointerInList, altHeld])

    const rowProps = (row: TreeNode, pos: number) => {
        if (!decorations) return {pos}
        const editable = isEditableRow(row, ownPath, timelineActive)
        return {pos, editable, patchDot: pos === decorations.dotPos, editHint: pos === decorations.editHintPos && editable}
    }

    return <>
        {(viewState.showSearch) && <div className="ts-search-block">
                <div className="tw-reset"><SearchBar isQuickLink={viewState.isQuickLink}/></div>
                {allowTimeline && <div className="tw-reset"><RecencyFilterBar/></div>}
            </div>
        }

        {!paneFills && <div className="flex-1 overflow-y-auto"
             onMouseEnter={() => setPointerInList(true)}
             onMouseLeave={() => setPointerInList(false)}
             onMouseMove={allowEditing ? (ev => { if (ev.altKey !== altHeld) setAltHeld(ev.altKey) }) : undefined}
        >
            {viewState.isLoading ? (
                <LoadingDots />
            ) : rows.length === 0 && !outline ? (
                actualQuery.trim().length >= 3 && (timelineActive || recencyWindow !== "all")
                    ? <div className="ts-timeline-empty">No {timelineActive ? "dated " : ""}matches{recencyWindow !== "all" ? ` in the last ${recencyWindow}` : ""}</div>
                    // Only the main search modal shows the syntax cheat sheet (not while the `<` chain
                    // replaces the search); auxiliary panes (file context, parents, tasks, inline results) stay blank.
                    : viewState.isModal && !chainActive ? <SearchHelp /> : null
            ) : (
                <>
                    {rows.map((tree, index) => timelineActive
                        ? <TimelineRow node={tree} key={`${index}`} {...rowProps(tree, index)}/>
                        : <React.Fragment key={`${index}`}>
                            {index === editPos && lineEdit
                                ? <LineEditor key={lineEdit.id} edit={lineEdit} rows={rows}/>
                                : <SearchTreeNode node={tree} {...rowProps(tree, index)}/>}
                            {(footers.get(tree.index) ?? []).map((f, j) => <BlockMoreFooter key={j} footer={f}/>)}
                        </React.Fragment>
                    )}
                    {outline && lineEdit && editPos < 0 && <LineEditor key={lineEdit.id} edit={lineEdit} rows={rows}/>}
                    {newLineShown && <NewLineRow label={addToLabel} selected={newLineSelected} onOpen={() => openAddTo()}/>}
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
        </div>}

        {viewState.showSearch && <ActionFooter/>}
    </>
};

/** The trailing row, `Add to <root>…` (openAddToAtom): the line editor on a new line at the end of the view (in the
 *  plain search, after exploring the selected row). ↓ past the last row selects it (NEW_LINE_ROW); Enter opens it. */
const NewLineRow = ({label, selected, onOpen}: {label: string; selected: boolean; onOpen: () => void}) => {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (selected) ref.current?.scrollIntoView({behavior: "auto", block: "nearest"})
    }, [selected])
    return <div className="tree-node ts-new-line" onClick={onOpen}>
        <div ref={ref} className={`ts-list-line ${selected ? "highlight" : ""}`} style={{'--indent-level': 1} as React.CSSProperties}>
            <div className="ts-list-guides">
                <span className="ts-formatting ts-formatting-list ts-formatting-list-ul ts-list-1"><span className="ts-list-bullet">+</span></span>
            </div>
            <div className="ts-list-content">{label}…</div>
        </div>
    </div>
}

const LoadingDots = () => {
    return <div className="flex justify-center items-center space-x-1 text-6xl font-bold text-gray-600 dark:text-gray-300">
        <span className="animate-bounce [animation-delay:-0.3s]">.</span>
        <span className="animate-bounce [animation-delay:-0.15s]">.</span>
        <span className="animate-bounce">.</span>
    </div>
}
