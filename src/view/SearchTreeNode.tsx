import {useEffect, useMemo, useRef} from "react";
import {formatRelativeDate, isUndated, ParsedNode, textSourceDate, UNDATED_AGE} from "@mdtree/core";
import {Platform} from "obsidian";
import {Pencil} from "lucide-react";
import {BaseNodeRender} from "./NodeRenderer";
import {fileAgeDays, resolveThumbnail, stripDateAnnotations} from "./search/timeline-utils";
import {TreeNode} from "./search/SearchViewFlatten";
import {useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {GlobalAppMolecule, SearchViewMolecule} from "./react-context/state";
import {ActionsMolecule} from "./react-context/actions";
import {triggerLocationPreview} from "./hover-preview";
import {EditorMolecule} from "./editor/EditorMolecule";
import {AppendDot} from "./editor/AppendDot";
import {dragInfo, isValidDropTarget, type AppendTarget} from "./editor/row-editing";
import {useRowGestures} from "./search/row-gestures";
import {TaskCheckbox} from "./search/TaskCheckbox";

type SearchTreeNodePropsFlatten = {
    node: TreeNode;
    /** Position among the rendered rows. */
    pos: number;
    editable?: boolean;
    appendDot?: AppendTarget;
    editHint?: boolean;
    /** The editor's link list: a click picks the row instead of selecting/opening it (its links included), and the
     *  row never takes focus from the editor. */
    onPick?: (node: TreeNode) => void;
};

export const SearchTreeNode = (props: SearchTreeNodePropsFlatten) => {

    const {expandNodeAtom, selectedLineAtom, flashLineAtom, updateHoveredLineAtom, matchTermsAtom, allowEditing, renderableTreeNodesAtom} = useMolecule(SearchViewMolecule)
    const {appAtom} = useMolecule(GlobalAppMolecule)
    const {selectHoveredLineAtom} = useMolecule(ActionsMolecule)
    const {dragIndexAtom, dropTargetAtom, reparentAtom, clearDragAtom} = useMolecule(EditorMolecule)
    const editGestures = useRowGestures(props.node, props.editable ?? false)
    const rows = useAtomValue(renderableTreeNodesAtom)
    const dragIndex = useAtomValue(dragIndexAtom)
    const dropTarget = useAtomValue(dropTargetAtom)
    const setDragIndex = useSetAtom(dragIndexAtom)
    const setDropTarget = useSetAtom(dropTargetAtom)
    const reparent = useSetAtom(reparentAtom)
    const clearDrag = useSetAtom(clearDragAtom)

    const nodeRef = useRef<HTMLDivElement>(null);
    const selectedLine = useAtomValue(selectedLineAtom);
    const flashing = useAtomValue(flashLineAtom) === props.node.index ? "ts-row-flash" : "";
    const matchTerms = useAtomValue(matchTermsAtom);
    const app = useAtomValue(appAtom);

    const expandNode = useSetAtom(expandNodeAtom);
    const updateHovered = useSetAtom(updateHoveredLineAtom);
    const selectHovered = useSetAtom(selectHoveredLineAtom);

    const expandableClass = props.node.hasChildren ? "is-collapsed " : ""
    const highlighted = selectedLine == props.node.index ? "highlight" : "";
    // Dim rows that match no query stage (context shown only for structure); the
    // query's own hits stay bright. The `matched` flag is computed in flattenIndex.
    const dimClass = props.node.matched ? "" : "ts-node-dim";
    // Archived rows (revealed via is:archived) get a distinct greyed treatment,
    // composed with — and independent of — the context-dim above.
    const archivedClass = props.node.archived ? "ts-node-archived" : "";
    const className = `ts-list-line ts-list-line-${props.node.indent + 1} ${highlighted} ${expandableClass}`;

    const indentLevel = props.node.indent + 1;

    const sourceDate = textSourceDate(props.node.node);
    // Undated rows show their file's creation date, as in the Timeline.
    const fromFile = isUndated(props.node.node.ageDays);
    const date = formatRelativeDate(fromFile ? fileAgeDays(app, props.node.node) ?? UNDATED_AGE : props.node.node.ageDays, sourceDate);
    // The date sits on the right; drop its in-text repeats from the rendered line.
    const shownNode = useMemo(() => sourceDate ? stripDateAnnotations(props.node.node, sourceDate) : props.node.node, [props.node.node, sourceDate]);
    const thumb = useMemo(() => app ? resolveThumbnail(app, props.node.node) : null, [app, props.node.node]);

    // Scroll to the selected line
    useEffect(() => {
        if (selectedLine === props.node.index && nodeRef.current) {
            nodeRef.current.scrollIntoView({
                behavior: "auto",
                block: "nearest",
            });
        }
    }, [selectedLine, props.node.index]);

    // async function openFile(attrs: ParsedNode) {
    //     await highlightLine(app, attrs.location);
    //     const customEvent = new CustomEvent(GraphEvents.RESULT_SELECTED, {detail: {type: "mouse"}});
    //     window.dispatchEvent(customEvent);
    // }

    function handleMouseMove(ev: any) {
        updateHovered(props.node.index);

        ev.preventDefault();
    }

    // Cmd/Ctrl+hover over the row body previews the location where the relation
    // was recorded. Anchors (wikilinks) stop propagation so they preview their
    // own target instead. Page Preview enforces the mod-key gating via the
    // registered source's `defaultMod`, so we always forward the native event.
    // The synthetic Archive row has no source location, so it never previews.
    function handleMouseOver(ev: React.MouseEvent<HTMLDivElement>) {
        if (!app || props.node.archiveRow) return;
        triggerLocationPreview(app, ev.nativeEvent, ev.currentTarget, props.node.node.location);
    }

    async function handleTreeNodeClick(ev: any) {
        if (ev.isDefaultPrevented()) {
            return;
        }

        await selectHovered();
    }

    function handleUserExpandClicked(ev: any) {
        expandNode(props.node.index);
        ev.preventDefault();
    }
    // Drag-to-reparent: Tree rows only, desktop only (HTML5 DnD doesn't work with touch); never the editor's link list.
    const dragEnabled = allowEditing && !props.onPick && !Platform.isMobile
    const drag = dragEnabled ? dragInfo(rows, props.pos) : {draggable: false, refusal: undefined}
    const dragHandlers: React.HTMLAttributes<HTMLDivElement> = dragEnabled ? {
        onDragStart: ev => {
            ev.dataTransfer.setData("text/plain", "")
            ev.dataTransfer.effectAllowed = "move"
            setDragIndex(props.pos)
        },
        onDragEnd: () => clearDrag(),
        onDragOver: ev => {
            if (dragIndex !== null && isValidDropTarget(rows, dragIndex, props.pos)) {
                ev.preventDefault()
                ev.dataTransfer.dropEffect = "move"
                if (dropTarget !== props.pos) setDropTarget(props.pos)
            } else {
                ev.dataTransfer.dropEffect = "none"
            }
        },
        onDragLeave: () => { if (dropTarget === props.pos) setDropTarget(null) },
        onDrop: ev => {
            ev.preventDefault()
            const from = dragIndex
            clearDrag()
            if (from !== null && isValidDropTarget(rows, from, props.pos)) void reparent(from, props.pos)
        },
    } : {}

    // Picking: the capture phase beats the row's links; the guides' expand click still goes through.
    const pickHandlers: React.HTMLAttributes<HTMLDivElement> = props.onPick ? {
        onMouseDown: ev => ev.preventDefault(),
        onClickCapture: ev => {
            if ((ev.target as Element).closest(".ts-list-guides")) return
            ev.preventDefault()
            ev.stopPropagation()
            props.onPick!(props.node)
        },
    } : editGestures

    return (
        <div className="tree-node"
                onMouseMove={(ev) => handleMouseMove(ev)}
                onMouseOver={handleMouseOver}
                onClick={handleTreeNodeClick}
                draggable={drag.draggable || undefined}
                {...dragHandlers}
                {...pickHandlers}
        >
            <div
                ref={nodeRef}
                className={`ts-list-line ${highlighted} ${flashing} ${expandableClass} ${dimClass} ${archivedClass} ${dropTarget === props.pos ? "ts-drop-target" : ""}`}
                dir="ltr"
                style={{ '--indent-level': indentLevel } as React.CSSProperties}
            >
                <div className="ts-list-guides" onClick={handleUserExpandClicked}>
                    <GuideLines indent={indentLevel}/>
                    <BulletOrTask
                        indent={indentLevel}
                        node={props.node.node}
                        interactive={!props.onPick}
                    />
                </div>
                <div className="ts-list-content"
                     area-label={props.node.node.location.path} title={drag.refusal ?? props.node.node.location.path}>
                    <span className="ts-row-text"><BaseNodeRender node={shownNode} matchTerms={matchTerms}/></span>
                    {thumb && <img className="ts-row-thumb" src={thumb} alt="" loading="lazy"/>}
                    {date && <span className="ts-row-date" title={fromFile ? `${date.absolute} · file created` : date.absolute}>{date.label}</span>}
                </div>
            </div>
            {props.appendDot && <AppendDot target={props.appendDot}/>}
            {props.editHint && <Pencil size={12} className="ts-edit-hint"/>}
        </div>
    );
};

type BulletOrTaskProps = {
    indent: number;
    node: ParsedNode;
    /** Task checkbox completes/reopens the task (not in pick mode). */
    interactive: boolean;
}

const BulletOrTask = ({indent, node, interactive}: BulletOrTaskProps) => {
    if (node.nodeType === "text" && node.isTask) return <TaskCheckbox node={node} interactive={interactive}/>;

    return <span className={"ts-formatting ts-formatting-list ts-formatting-list-ul ts-list-" + indent}>
        <span className="ts-list-bullet">-</span>
    </span>;
};

export const GuideLines = ({indent}: { indent: number }) => {
    if (indent === 1) return <></>;

    // Create guide lines for all levels up to current indent
    return <>
        {Array.from({length: indent - 1}, (_, i) => (
            <div 
                key={i} 
                className="ts-guide-line"
                style={{ '--guide-index': i + 1 } as React.CSSProperties}
            />
        ))}
    </>;
};
