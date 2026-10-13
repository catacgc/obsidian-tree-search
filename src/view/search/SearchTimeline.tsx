import React, {useEffect, useMemo, useRef, useState} from "react";
import {useAtom, useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {isUndated, rowDate, textSourceDate, type BlockLine} from "@mdtree/core";
import {Pencil} from "lucide-react";
import {GlobalAppMolecule, SearchViewMolecule, RECENCY_WINDOWS} from "../react-context/state";
import {ActionsMolecule} from "../react-context/actions";
import {triggerLocationPreview} from "../hover-preview";
import {BaseNodeRender, highlightText} from "../NodeRenderer";
import {TreeNode} from "./SearchViewFlatten";
import {resolveThumbnail, stripDateAnnotations, timelineCrumbs} from "./timeline-utils";
import {AppendDot} from "../editor/AppendDot";
import type {AppendTarget} from "../editor/row-editing";
import {useRowGestures} from "./row-gestures";
import {TaskCheckbox} from "./TaskCheckbox";
import {filterActive, isFilterSuggestion} from "./search-filter";
import {searchFiltersAtom} from "../react-context/settings";
import {GlobalAtoms} from "../react-context/global";
import {cutKeyOf} from "./cut-drawer";

/** Enter/Space handler for a div-button chip: runs `run`, keeping KeyComboWrapper's Enter (open selection) from
 *  also firing. */
const chipKeys = (run: () => void) => (ev: React.KeyboardEvent) => {
    if (ev.key !== "Enter" && ev.key !== " ") return
    ev.preventDefault()
    ev.stopPropagation()
    run()
}

// Recency chips (All / 7d / 30d / 1y), in Tree and Timeline mode, filter the
// results locally with `in:` semantics without touching the query. After a
// separator, the user's filter pills (searchFiltersAtom; Tasks = `is:task` by
// default) toggle their `:Name` reference in the search query. While the `:`
// autocomplete is open, the pills it offers are tinted, and the dropdown's
// current row a bit stronger. Divs, not <button>s: Obsidian's button chrome
// breaks the layout (see SearchHelp's SyntaxRow).
export const RecencyFilterBar = () => {
    const {recencyWindowAtom, actualQueryAtom, toggleFilterAtom, suggestionsAtom, suggestionIndexAtom} = useMolecule(SearchViewMolecule)
    const [recencyWindow, setRecencyWindow] = useAtom(recencyWindowAtom)
    const query = useAtomValue(actualQueryAtom)
    const filters = useAtomValue(searchFiltersAtom)
    const suggestions = useAtomValue(suggestionsAtom)
    const suggestionIndex = useAtomValue(suggestionIndexAtom)
    const toggle = useSetAtom(toggleFilterAtom)

    const candidates = new Set(suggestions.filter(isFilterSuggestion).map(s => s.filterName))
    const focused = suggestions[suggestionIndex]
    const focusedName = focused && isFilterSuggestion(focused) ? focused.filterName : null
    const barRef = useRef<HTMLDivElement>(null)
    // The bar scrolls sideways: keep the `:` autocomplete's current pill visible.
    useEffect(() => {
        barRef.current?.querySelector(".is-candidate-selected")?.scrollIntoView({block: "nearest", inline: "nearest"})
    }, [focusedName])

    return <div className="ts-timeline-filters" ref={barRef}>
        {RECENCY_WINDOWS.map(w => <div
            key={w}
            role="button"
            tabIndex={0}
            className={`ts-timeline-chip ${recencyWindow === w ? "is-active" : ""}`}
            title={w === "all" ? "Any date" : `in:${w}`}
            onClick={() => setRecencyWindow(w)}
            onKeyDown={chipKeys(() => setRecencyWindow(w))}
        >{w === "all" ? "All" : w}</div>)}
        {filters.length > 0 && <span className="ts-timeline-filters-sep" aria-hidden="true">|</span>}
        {filters.map(f => <div key={f.name} role="button" tabIndex={0}
             className={["ts-timeline-chip",
                 filterActive(query, f) && "is-active",
                 candidates.has(f.name) && "is-candidate",
                 focusedName === f.name && "is-candidate-selected"].filter(Boolean).join(" ")}
             title={`:${f.name} — ${f.query}`} onClick={() => toggle(f)} onKeyDown={chipKeys(() => toggle(f))}>{f.name}</div>)}
    </div>
}

// Flat timeline row: matched line + date, with a faint breadcrumb of matched
// ancestors (else its in-note parent, else the source note) below and an
// optional image thumbnail. When the last matched ancestor is a note the line
// links (an inline parent), the breadcrumb is its outline parent instead
// (buildTimelineRows).
// Interaction mirrors SearchTreeNode (click selects, click again opens).
type TimelineRowProps = {
    node: TreeNode
    /** Position among the rendered rows. */
    pos: number
    editable?: boolean
    appendDot?: AppendTarget
    editHint?: boolean
}

export const TimelineRow = ({node, editable, appendDot, editHint}: TimelineRowProps) => {
    const {selectedLineAtom, flashLineAtom, updateHoveredLineAtom, matchTermsAtom, setBlockOpenAtom} = useMolecule(SearchViewMolecule)
    const {appAtom} = useMolecule(GlobalAppMolecule)
    const {selectHoveredLineAtom} = useMolecule(ActionsMolecule)
    const editGestures = useRowGestures(node, editable ?? false)

    const nodeRef = useRef<HTMLDivElement>(null)
    const selectedLine = useAtomValue(selectedLineAtom)
    const flashing = useAtomValue(flashLineAtom) === node.index ? "ts-row-flash" : ""
    const matchTerms = useAtomValue(matchTermsAtom)
    const cut = useAtomValue(GlobalAtoms.cutKeysAtom).has(cutKeyOf(node.node)) ? "ts-row-cut" : ""
    const app = useAtomValue(appAtom)

    const updateHovered = useSetAtom(updateHoveredLineAtom)
    const selectHovered = useSetAtom(selectHoveredLineAtom)
    const setBlockOpen = useSetAtom(setBlockOpenAtom)

    useEffect(() => {
        if (selectedLine === node.index && nodeRef.current) {
            nodeRef.current.scrollIntoView({behavior: "auto", block: "nearest"})
        }
    }, [selectedLine, node.index])

    function handleMouseMove(ev: React.MouseEvent<HTMLDivElement>) {
        updateHovered(node.index)
        ev.preventDefault()
    }

    function handleMouseOver(ev: React.MouseEvent<HTMLDivElement>) {
        if (!app) return
        triggerLocationPreview(app, ev.nativeEvent, ev.currentTarget, node.node.location)
    }

    async function handleClick(ev: React.MouseEvent<HTMLDivElement>) {
        if (ev.isDefaultPrevented()) return
        await selectHovered()
    }

    const sourceDate = textSourceDate(node.node)
    const date = rowDate(node.node, node.timeline?.ageDays ?? node.node.ageDays)
    // Undated nodes are dated by their file's ctime (see buildTimelineRows).
    const fromFile = isUndated(node.node.ageDays)
    // The date sits on the right; drop its in-text repeats from the rendered line.
    const shownNode = useMemo(() => sourceDate ? stripDateAnnotations(node.node, sourceDate) : node.node, [node.node, sourceDate])
    const crumbs = timelineCrumbs(node)
    const thumb = useMemo(() => app ? resolveThumbnail(app, node.node) : null, [app, node.node])
    const highlighted = selectedLine === node.index ? "highlight" : ""
    // Block item (a hit inside a list): its lines, compacted until "+N more" is clicked.
    const block = node.timeline?.block ?? []
    const hiddenLines = block.filter(l => !l.preview).length
    const blockOpen = node.blockOpen === true

    return <div className="tree-node" onMouseMove={handleMouseMove} onMouseOver={handleMouseOver} onClick={handleClick} {...editGestures}>
        <div ref={nodeRef}
             className={`ts-timeline-row ${highlighted} ${flashing} ${node.archived ? "ts-node-archived" : ""} ${cut}`}
             title={node.node.location.path}>
            <TaskCheckbox node={node.node} interactive={true}/>
            <div className="ts-timeline-body">
                <div className="ts-row-text"><BaseNodeRender node={shownNode} matchTerms={matchTerms}/></div>
                {crumbs.length > 0 && <div className="ts-timeline-breadcrumb">
                    {crumbs.map((c, i) => <React.Fragment key={i}>{i > 0 && " > "}{highlightText(c, matchTerms)}</React.Fragment>)}
                </div>}
                {block.length > 0 && <div className="ts-block-lines">
                    {(blockOpen ? block : block.filter(l => l.preview)).map((l, i) =>
                        <TimelineBlockLine key={i} line={l} anchor={node.node} matchTerms={matchTerms}/>)}
                    {!blockOpen && hiddenLines > 0 && <div role="button" tabIndex={0} className="ts-block-more"
                        onClick={ev => {
                            ev.stopPropagation()
                            setBlockOpen(node.index, true)
                        }}
                        onKeyDown={chipKeys(() => setBlockOpen(node.index, true))}>+{hiddenLines} more</div>}
                </div>}
            </div>
            {thumb && <img className="ts-row-thumb" src={thumb} alt="" loading="lazy"/>}
            {date && <span className="ts-row-date" title={fromFile ? `${date.absolute} · file created` : date.absolute}>{date.label}</span>}
        </div>
        {appendDot && <AppendDot target={appendDot}/>}
        {editHint && <Pencil size={12} className="ts-edit-hint"/>}
    </div>
}

/** One line of a timeline block row: checkbox or bullet, text, date; dimmed when it does not match. Clicking its text
 *  bubbles to the row (select / open the block root); the checkbox keeps the row selected. */
const TimelineBlockLine = ({line, anchor, matchTerms}: {line: BlockLine; anchor: TreeNode["node"]; matchTerms: string[]}) => {
    const sourceDate = textSourceDate(line.node)
    const date = sourceDate !== null ? rowDate(line.node, line.node.ageDays) : null
    const task = line.node.nodeType === "text" && line.node.isTask
    return <div className={`ts-block-line ${line.matched ? "" : "ts-node-dim"}`} style={{paddingLeft: `${(line.depth - 1) * 16}px`}}>
        {task ? <TaskCheckbox node={line.node} interactive anchor={anchor}/> : <span className="ts-list-bullet">-</span>}
        <BaseNodeRender node={line.node} matchTerms={matchTerms}/>
        {date && <span className="ts-row-date" title={date.absolute}>{date.label}</span>}
    </div>
}
