import {useSetAtom} from "jotai"
import {useMolecule} from "bunshi/react"
import type {ParsedNode} from "@mdtree/core"
import {EditorMolecule} from "../editor/EditorMolecule"

const stop = (ev: React.SyntheticEvent) => ev.stopPropagation()

/** A task row's checkbox (Tree and Timeline). Interactive: a click completes or reopens the task in its note
 *  (editTaskAtom) and nothing else: no select/open/expand, no drag. Null for non-task rows. */
export function TaskCheckbox({node, interactive}: {node: ParsedNode; interactive: boolean}) {
    const editTask = useSetAtom(useMolecule(EditorMolecule).editTaskAtom)
    if (node.nodeType !== "text" || !node.isTask) return null
    const done = node.isCompleted
    return <label className="task-list-label" draggable={false} onClick={interactive ? stop : undefined}>
        {/* Controlled: an uncontrolled box kept a reused DOM node's checked state across queries. The index refresh
            after the write flips it. */}
        <input className="task-list-item-checkbox" type="checkbox" checked={done} data-task={done ? "x" : ""}
               draggable={false}
               readOnly={!interactive}
               aria-label={interactive ? (done ? "Mark task not done" : "Mark task done") : undefined}
               onChange={interactive ? () => void editTask(node, {kind: "done", done: !done}) : undefined}/>
    </label>
}
