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

    // return <TreeNodeExperiment/>

    return (
        <>
            
            <div className="tree-search-page">
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
                                type={props.node.attrs.nodeType}
                            />
                        </div>
                        <div className="ts-list-content">
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

const TreeNodeExperiment = () => {
    return <div className="tree-node">
        <div className="ts-list-line ts-list-line-1">
            <div className="ts-list-guides">
                <div className="ts-list-bullet"></div>
            </div>
            <div className="ts-list-content">
                <div className="ts-list-text">Node1</div>
            </div>
        </div>
        <div className="ts-list-line ts-list-line-2">
            <div className="ts-list-guides">
                <div className="ts-guide-line"></div>
                <div className="ts-list-bullet"></div>
            </div>
            <div className="ts-list-content">
                <div className="ts-list-text">Node2</div>
            </div>
        </div>
        <div className="ts-list-line ts-list-line-3 is-collapsed">
            <div className="ts-list-guides">
                <div className="ts-guide-line"></div>
                <div className="ts-guide-line"></div>
                <div className="ts-list-bullet"></div>
            </div>
            <div className="ts-list-content">
                <div className="ts-list-text">Node3</div>
            </div>
        </div>
        <div className="ts-list-line ts-list-line-3 is-collapsed">
            <div className="ts-list-guides">
                <div className="ts-guide-line"></div>
                <div className="ts-guide-line"></div>
                <div className="ts-list-bullet"></div>
            </div>
            <div className="ts-list-content">
                <div className="ts-list-text">Node4</div>
            </div>
        </div>
        <div className="ts-list-line ts-list-line-1">
            <div className="ts-list-guides">
                <div className="ts-list-bullet"></div>
            </div>
            <div className="ts-list-content">
                <div className="ts-list-text">Node5</div>
            </div>
        </div>
    </div>
}