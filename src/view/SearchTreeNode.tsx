import {useEffect, useRef, useState} from "react";
import {ParsedNode} from "src/graph";
import {highlightLine} from "src/obsidian-utils";
import {NodeRenderer} from "./NodeRenderer";
import {GraphEvents} from "./obsidian-views/GraphEvents";
import {useApp} from "./react-context/AppContext";
import {TreeNode} from "./search/SearchViewFlatten";
import { selectedLineAtom, expandVisibleNodesAtom, selectHoveredLineAtom, expandNodeAtom } from "./react-context/state";
import { useAtomValue, useSetAtom } from "jotai";

type SearchTreeNodePropsFlatten = {
    node: TreeNode;
};

export const SearchTreeNode = (props: SearchTreeNodePropsFlatten) => {
    const nodeRef = useRef<HTMLDivElement>(null);
    const app = useApp();
    const selectedLine = useAtomValue(selectedLineAtom);

    const expandNode = useSetAtom(expandNodeAtom);
    const selectHovered = useSetAtom(selectHoveredLineAtom);

    const expandableClass = props.node.hasChildren ? "is-collapsed " : ""
    const highlighted = selectedLine == props.node.index ? "highlight" : "";
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

    async function openFile(attrs: ParsedNode) {
        await highlightLine(app, attrs.location);
        const customEvent = new CustomEvent(GraphEvents.RESULT_SELECTED, {detail: {type: "mouse"}});
        window.dispatchEvent(customEvent);
    }

    function handleMouseMove(ev: any) {
        selectHovered(props.node.index);

        ev.preventDefault();
    }

    async function handleTreeNodeClick(ev: any) {
        if (ev.isDefaultPrevented()) {
            return;
        }
        await openFile(props.node.node);
    }

    function handleUserExpandClicked(ev: any) {
        expandNode(props.node.index);
        ev.preventDefault();
    }

    // return <TreeNodeExperiment/>

    return (
        <div className="tree-node"
                onMouseMove={(ev) => handleMouseMove(ev)}
                onClick={handleTreeNodeClick}
        >
            <div
                ref={nodeRef}
                className={`ts-list-line ${highlighted} ${expandableClass}`}
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
                <div className="ts-list-content">
                    <NodeRenderer node={props.node.node}/>
                    {/* {props.node.node.aliases.length > 0 && `(${props.node.node.aliases.join(", ")})`} */}
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