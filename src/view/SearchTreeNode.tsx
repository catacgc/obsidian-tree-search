import {useEffect, useRef, useState} from "react";
import {NodeAttributes} from "src/graph";
import {highlightLine} from "src/obsidian-utils";
import {NodeRenderer} from "./NodeRenderer";
import {GraphEvents} from "./obsidian-views/GraphEvents";
import {useApp} from "./react-context/AppContext";
import {TreeNode} from "./search/SearchViewFlatten";
import { selectedLineAtom, expandVisibleNodesAtom, selectHoveredLineAtom, expandNodeAtom } from "./react-context/state";
import { useAtomValue, useSetAtom } from "jotai";

type SearchTreeListPropsFlatten = {
    node: TreeNode;
};

export const SearchTreeNode = (props: SearchTreeListPropsFlatten) => {
    const nodeRef = useRef<HTMLDivElement>(null);
    const app = useApp();
    const selectedLine = useAtomValue(selectedLineAtom);

    const expandNode = useSetAtom(expandNodeAtom);
    const selectHovered = useSetAtom(selectHoveredLineAtom);

    const expandableClass = props.node.hasChildren ? "is-collapsed " : ""
    const highlighted = selectedLine == props.node.index ? "highlight" : "";
    const className = `HyperMD-list-line HyperMD-list-line-${props.node.indent + 1} 
        cm-line ${highlighted} tree-node ${expandableClass}`;

    const indent = `${24 + 34 * props.node.indent}px`;

    // Scroll to the selected line
    useEffect(() => {
        if (selectedLine === props.node.index && nodeRef.current) {
            nodeRef.current.scrollIntoView({
                behavior: "auto",
                block: "nearest",
            });
        }
    }, [selectedLine, props.node.index]);

    async function openFile(attrs: NodeAttributes) {
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
        await openFile(props.node.attrs);
    }

    function handleUserExpandClicked(ev: any) {
        expandNode(props.node.index);
        ev.preventDefault();
    }

    return (
        <>
            <div className="cm-content tree-search-page">
                <div className="markdown-source-view mod-cm6 is-live-preview">
                    <div className="tree-node"
                         onMouseMove={(ev) => handleMouseMove(ev)}
                         onClick={handleTreeNodeClick}
                    >
                        <div
                            ref={nodeRef}
                            className={className}
                            dir="ltr"
                            style={{textIndent: "-" + indent, paddingInlineStart: indent}}
                        >
                    <span onClick={handleUserExpandClicked}>
                        <CmListIndent indent={props.node.indent + 1}/>
                        <BulletOrTask
                            indent={props.node.indent + 1}
                            type={props.node.attrs.nodeType}
                        />
                    </span>
                            <NodeRenderer tokens={props.node.attrs.tokens}/>
                            {props.node.attrs.aliases.length > 0 && `(${props.node.attrs.aliases.join(", ")})`}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};

type BulletOrTaskProps = {
    indent: number;
    type: string;
}

const BulletOrTask = ({indent, type}: BulletOrTaskProps) => {

    if (type === "task") {
        return <label className="task-list-label">
            <input className="task-list-item-checkbox" type="checkbox" data-task=""/>
        </label>;
    } else if (type === "completed-task") {
        return <label className="task-list-label">
            <input className="task-list-item-checkbox" type="checkbox" checked={true} readOnly={true} data-task="x"/>
        </label>;
    }

    return <span className={"cm-formatting cm-formatting-list cm-formatting-list-ul cm-list-" + indent}>
        <span className="list-bullet">-</span>
    </span>;
};

const CmListIndent = ({indent}: { indent: number }) => {
    if (indent === 1) return <></>;

    return (
        <span className={`cm-hmd-list-indent cm-hmd-list-indent-${indent}`}>
            {Array.from({length: indent - 1}, (_, i) => (
                <span key={i} className="cm-indent"></span>
            ))}
        </span>
    );
};
