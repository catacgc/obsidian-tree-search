import {useEffect, useRef} from "react";
import {ParsedNode} from "@mdtree/core";
import {NodeRenderer} from "./NodeRenderer";
import {TreeNode} from "./search/SearchViewFlatten";
import {useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {GlobalAppMolecule, SearchViewMolecule} from "./react-context/state";
import {ActionsMolecule} from "./react-context/actions";
import {triggerLocationPreview} from "./hover-preview";

type SearchTreeNodePropsFlatten = {
    node: TreeNode;
};

export const SearchTreeNode = (props: SearchTreeNodePropsFlatten) => {

    const {expandNodeAtom, selectedLineAtom, updateHoveredLineAtom, matchTermsAtom} = useMolecule(SearchViewMolecule)
    const {appAtom} = useMolecule(GlobalAppMolecule)
    const {selectHoveredLineAtom} = useMolecule(ActionsMolecule)

    const nodeRef = useRef<HTMLDivElement>(null);
    const selectedLine = useAtomValue(selectedLineAtom);
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
    function handleMouseOver(ev: React.MouseEvent<HTMLDivElement>) {
        if (!app) return;
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

    return (
        <div className="tree-node"
                onMouseMove={(ev) => handleMouseMove(ev)}
                onMouseOver={handleMouseOver}
                onClick={handleTreeNodeClick}
        >
            <div
                ref={nodeRef}
                className={`ts-list-line ${highlighted} ${expandableClass} ${dimClass} ${archivedClass}`}
                dir="ltr"
                style={{ '--indent-level': indentLevel } as React.CSSProperties}
            >
                <div className="ts-list-guides" onClick={handleUserExpandClicked}>
                    <GuideLines indent={indentLevel}/>
                    <BulletOrTask
                        indent={indentLevel}
                        node={props.node.node}
                    />
                </div>
                <div className="ts-list-content flex flex-row justify-between"
                     area-label={props.node.node.location.path} title={props.node.node.location.path}>
                    <div>
                    <NodeRenderer node={props.node.node} matchTerms={matchTerms}/>
                    </div>

                    {/*<div className="flex justify-end text-xs">*/}
                    {/*    {props.node.node.location.path}*/}
                    {/*    /!* {props.node.node.aliases.length > 0 && `(${props.node.node.aliases.join(", ")})`} *!/*/}
                    {/*</div>*/}
                </div>
            </div>
        </div>
    );
};

type BulletOrTaskProps = {
    indent: number;
    node: ParsedNode;
}

const BulletOrTask = ({indent, node}: BulletOrTaskProps) => {

    if (node.nodeType === "text" && node.isTask && !node.isCompleted) {
        return <label className="task-list-label">
            <input className="task-list-item-checkbox" type="checkbox" data-task=""/>
        </label>;
    } else if (node.nodeType === "text" && node.isTask && node.isCompleted) {
        return <label className="task-list-label">
            <input className="task-list-item-checkbox" type="checkbox" checked={true} readOnly={true} data-task="x"/>
        </label>;
    }

    return <span className={"ts-formatting ts-formatting-list ts-formatting-list-ul ts-list-" + indent}>
        <span className="ts-list-bullet">-</span>
    </span>;
};

const GuideLines = ({indent}: { indent: number }) => {
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
