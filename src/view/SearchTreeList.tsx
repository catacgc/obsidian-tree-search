import { useEffect, useRef, useState } from "react";
import { NodeAttributes } from "src/graph";
import { highlightLine } from "src/obsidian-utils";
import { ResultNode } from "../search";
import { NodeRenderer } from "./NodeRenderer";
import { GraphEvents } from "./obsidian-views/GraphEvents";
import { useApp } from "./react-context/AppContext";

type SearchTreeListProps = {
    node: ResultNode;
    level: number;
    selectedLine: number;
    selectHoveredLine: (line: number) => void;
    minExpand: number
};

export const SearchTreeList = (props: SearchTreeListProps) => {
    const nodeRef = useRef<HTMLDivElement>(null);
    const app = useApp();

    const expandableClass = props.node.children.length > 0 ? "is-collapsed " : ""
    const highlighted = props.selectedLine == props.node.index ? "highlight" : "";
    const className = `HyperMD-list-line HyperMD-list-line-${props.level + 1} 
        cm-line ${highlighted} tree-node ${expandableClass}`;

    const indent = `${24 + 34 * props.level}px`;
    const [expanded, setUserExpanded] = useState(props.level < props.minExpand)
    
    // Scroll to the selected line
    useEffect(() => {
        if (props.selectedLine === props.node.index && nodeRef.current) {
            nodeRef.current.scrollIntoView({
                behavior: "auto",
                block: "nearest",
            });
        }
    }, [props.selectedLine, props.node.index]);

    async function openFile(attrs: NodeAttributes) {
        await highlightLine(app, attrs.location);
        const customEvent = new CustomEvent(GraphEvents.RESULT_SELECTED, { detail: { type: "mouse" } });
        window.dispatchEvent(customEvent);
    }

    function handleMouseMove(ev: any) {
        props.selectHoveredLine(props.node.index);
        ev.preventDefault();
    }

    async function handleTreeNodeClick(ev: any) {
        if (ev.isDefaultPrevented()) {
            return;
        }
        await openFile(props.node.attrs);
    }

    function userExpandClicked(ev: any) {
        setUserExpanded(!expanded);
        ev.preventDefault();
    }

    return (
        <>
            <div className="tree-node"
                onMouseMove={handleMouseMove}
                onClick={handleTreeNodeClick}
            >
                <div
                    ref={nodeRef}
                    className={className}
                    dir="ltr"
                    style={{ textIndent: "-" + indent, paddingInlineStart: indent }}
                >
                    <span onClick={userExpandClicked}>
                        <CmListIndent indent={props.level + 1} />
                        <BulletOrTask
                            indent={props.level + 1}
                            type={props.node.attrs.nodeType}
                        />
                    </span>
                    <NodeRenderer tokens={props.node.attrs.tokens} />
                    {props.node.attrs.aliases.length > 0 && `(${props.node.attrs.aliases.join(", ")})`}
                </div>
            </div>

            {expanded && props.node.children.map((child) => (
                <SearchTreeList
                    node={child}
                    level={props.level + 1}
                    minExpand={props.minExpand}
                    selectedLine={props.selectedLine}
                    key={child.value + props.minExpand}
                    selectHoveredLine={props.selectHoveredLine}
                />
            ))}
        </>
    );
};


const CollapsedTreeIcon = ({ collapsed = true }) => {
    if (!collapsed) {
        return <div className="tree-item-icon collapse-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
                viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                className="svg-icon right-triangle"><path d="M3 8L12 17L21 8"></path></svg>
        </div>
    }

    return <div className="tree-item-icon collapse-icon is-collapsed">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
            viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            className="svg-icon right-triangle"><path d="M3 8L12 17L21 8"></path></svg></div>
}

type BulletOrTaskProps = {
    indent: number;
    type: string;
}

const BulletOrTask = ({ indent, type }: BulletOrTaskProps) => {


    if (type === "task") {
        return <label className="task-list-label">
            <input className="task-list-item-checkbox" type="checkbox" data-task="" />
        </label>;
    } else if (type === "completed-task") {
        return <label className="task-list-label">
            <input className="task-list-item-checkbox" type="checkbox" checked={true} readOnly={true} data-task="x" />
        </label>;
    }

    return <span className={"cm-formatting cm-formatting-list cm-formatting-list-ul cm-list-" + indent}>
        <span className="list-bullet">-</span>
    </span>;
};

const CmListIndent = ({ indent }: { indent: number }) => {
    if (indent === 1) return <></>;

    return (
        <span className={`cm-hmd-list-indent cm-hmd-list-indent-${indent}`}>
            {Array.from({ length: indent - 1 }, (_, i) => (
                <span key={i} className="cm-indent"></span>
            ))}
        </span>
    );
};
