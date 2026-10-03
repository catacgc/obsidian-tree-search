import React, {useEffect, useMemo, useRef} from "react";
import {useAtom, useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {isUndated} from "@mdtree/core";
import {Pencil} from "lucide-react";
import {GlobalAppMolecule, SearchViewMolecule, RECENCY_WINDOWS} from "../react-context/state";
import {ActionsMolecule} from "../react-context/actions";
import {triggerLocationPreview} from "../hover-preview";
import {BaseNodeRender, highlightText} from "../NodeRenderer";
import {TreeNode} from "./SearchViewFlatten";
import {formatTimelineDate, nodeLabel, resolveThumbnail, sourceNoteLabel, stripDateAnnotations, textSourceDate} from "./timeline-utils";
import {AppendDot} from "../editor/AppendDot";
import type {AppendTarget} from "../editor/row-editing";
import {useRowGestures} from "./row-gestures";

// Recency chips (All / 7d / 30d / 1y), in Tree and Timeline mode. Filters the
// results locally with `in:` semantics without touching the query. Divs, not
// <button>s: Obsidian's button chrome breaks the layout (see SearchHelp's SyntaxRow).
export const RecencyFilterBar = () => {
    const {recencyWindowAtom} = useMolecule(SearchViewMolecule)
    const [recencyWindow, setRecencyWindow] = useAtom(recencyWindowAtom)

    return <div className="ts-timeline-filters">
        {RECENCY_WINDOWS.map(w => <div
            key={w}
            role="button"
            tabIndex={0}
            className={`ts-timeline-chip ${recencyWindow === w ? "is-active" : ""}`}
            title={w === "all" ? "Any date" : `in:${w}`}
            onClick={() => setRecencyWindow(w)}
            onKeyDown={ev => {
                if (ev.key === "Enter" || ev.key === " ") {
                    // Keep KeyComboWrapper's Enter (open selection) from also firing.
                    ev.preventDefault()
                    ev.stopPropagation()
                    setRecencyWindow(w)
                }
            }}
        >{w === "all" ? "All" : w}</div>)}
    </div>
}

// Flat timeline row: matched line + date, with a faint breadcrumb of matched
// ancestors (else its in-note parent, else the source note) below and an
// optional image thumbnail.
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
    const {selectedLineAtom, flashLineAtom, updateHoveredLineAtom, matchTermsAtom} = useMolecule(SearchViewMolecule)
    const {appAtom} = useMolecule(GlobalAppMolecule)
    const {selectHoveredLineAtom} = useMolecule(ActionsMolecule)
    const editGestures = useRowGestures(node, editable ?? false)

    const nodeRef = useRef<HTMLDivElement>(null)
    const selectedLine = useAtomValue(selectedLineAtom)
    const flashing = useAtomValue(flashLineAtom) === node.index ? "ts-row-flash" : ""
    const matchTerms = useAtomValue(matchTermsAtom)
    const app = useAtomValue(appAtom)

    const updateHovered = useSetAtom(updateHoveredLineAtom)
    const selectHovered = useSetAtom(selectHoveredLineAtom)

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
    const date = formatTimelineDate(node.timeline?.ageDays ?? node.node.ageDays, sourceDate)
    // Undated nodes are dated by their file's ctime (see updateSearchResultsAtom).
    const fromFile = isUndated(node.node.ageDays)
    // The date sits on the right; drop its in-text repeats from the rendered line.
    const shownNode = useMemo(() => sourceDate ? stripDateAnnotations(node.node, sourceDate) : node.node, [node.node, sourceDate])
    const breadcrumb = node.timeline?.breadcrumb ?? []
    const crumbs = breadcrumb.length > 0
        ? breadcrumb.map(nodeLabel).filter(Boolean)
        : [sourceNoteLabel(node.node)].filter((c): c is string => !!c)
    const thumb = useMemo(() => app ? resolveThumbnail(app, node.node) : null, [app, node.node])
    const highlighted = selectedLine === node.index ? "highlight" : ""

    return <div className="tree-node" onMouseMove={handleMouseMove} onMouseOver={handleMouseOver} onClick={handleClick} {...editGestures}>
        <div ref={nodeRef}
             className={`ts-timeline-row ${highlighted} ${flashing} ${node.archived ? "ts-node-archived" : ""}`}
             title={node.node.location.path}>
            <div className="ts-timeline-body">
                <div className="ts-timeline-line">
                    <span className="ts-timeline-text"><BaseNodeRender node={shownNode} matchTerms={matchTerms}/></span>
                    {date && <span className="ts-timeline-date" title={fromFile ? `${date.absolute} · file created` : date.absolute}>{date.label}</span>}
                </div>
                {crumbs.length > 0 && <div className="ts-timeline-breadcrumb">
                    {crumbs.map((c, i) => <React.Fragment key={i}>{i > 0 && " > "}{highlightText(c, matchTerms)}</React.Fragment>)}
                </div>}
            </div>
            {thumb && <img className="ts-timeline-thumb" src={thumb} alt="" loading="lazy"/>}
        </div>
        {appendDot && <AppendDot target={appendDot}/>}
        {editHint && <Pencil size={12} className="ts-edit-hint"/>}
    </div>
}
