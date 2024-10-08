import {highlightLine} from "src/obsidian-utils";
import {ResultNode} from "../search";
import {useApp} from "./react-context/AppContext";
import {useEffect, useRef} from "react";
import {NodeAttributes} from "src/graph";
import {NodeRenderer} from "./NodeRenderer";
import {GraphEvents} from "./obsidian-views/GraphEvents";

type SearchTreeListProps = {
    node: ResultNode;
    level: number;
    selectedLine: number;
    selectHoveredLine: (line: number) => void;
};

export const SearchTreeList = (props: SearchTreeListProps) => {
    const nodeRef = useRef<HTMLDivElement>(null);
    const app = useApp();

    const className = `HyperMD-list-line HyperMD-list-line-${props.level + 1} cm-line`;
    const highlighted = props.selectedLine == props.node.index ? "highlight" : "";
    const indent = `${24 + 34 * props.level}px`;

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
        const customEvent = new CustomEvent(GraphEvents.RESULT_SELECTED, {detail: {type: "mouse"}});
        window.dispatchEvent(customEvent);
    }

    return (
        <>
            <div className="tree-node"
                 onMouseMove={() => props.selectHoveredLine(props.node.index)}
                 onClick={async (ev) => {
                     if (ev.isDefaultPrevented()) {
                         return;
                     }
                     await openFile(props.node.attrs);
                 }}
            >
                <div
                    ref={nodeRef}
                    className={`${className} ${highlighted} tree-node`}
                    dir="ltr"
                    style={{textIndent: "-" + indent, paddingInlineStart: indent}}
                >
                    <CmListIndent indent={props.level + 1}/>
                    <BulletOrTask
                        indent={props.level + 1}
                        type={props.node.attrs.nodeType}
                    />
                    <NodeRenderer tokens={props.node.attrs.tokens}/>
                    {props.node.attrs.aliases.length > 0 && `(${props.node.attrs.aliases.join(", ")})`}
                </div>
            </div>

            {props.node.children.map((child) => (
                <SearchTreeList
                    node={child}
                    level={props.level + 1}
                    selectedLine={props.selectedLine}
                    key={child.value}
                    selectHoveredLine={props.selectHoveredLine}
                />
            ))}
        </>
    );
};

const BulletOrTask = ({indent, type}: { indent: number; type: string }) => {
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
