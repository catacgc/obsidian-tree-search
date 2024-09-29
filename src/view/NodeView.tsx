import {ResultNode} from "../search";
import {useApp} from "./AppContext";
import {NodeAttributes} from "../graph";
import {openFileAndHighlightLine} from "../obsidian-utils";
import {NodeRenderer} from "./NodeRenderer";
import {ReactNode} from "react";
import ControlBar from "./ControlBar";

export const NodeView = (props: { node: ResultNode, index: number }) => {
	const app = useApp()

	async function openFile(attrs: NodeAttributes) {
		if (app == undefined) return
		await openFileAndHighlightLine(app, attrs.location.path, attrs.location.position.start, attrs.location.position.end)
	}

	const attrs = props.node.attrs

	let heading: ReactNode = "↳"
	if (props.node.attrs.nodeType == "task") {
		heading = <input type={"checkbox"} disabled={true}/>
	} else if (props.node.attrs.nodeType == "completed-task") {
		heading = <input type={"checkbox"} checked={true} disabled={true}/>
	} else if (props.index == 0) {
		heading = ""
	} else if (props.index == 1) {
		heading = "→"
	}

	return <div
		className="search-tree-node"
		onClick={async (ev) => {
			if (ev.isDefaultPrevented()) {
				return
			}
			await openFile(attrs)
		}}
	>
		{heading}
		<NodeRenderer
			tokens={props.node.attrs.tokens}/> {props.node.attrs.aliases.length > 0 && `(${props.node.attrs.aliases.join(", ")})`}
		<ControlBar
			onArchive={() => console.log('Archive clicked')}
			onFavourite={() => console.log('Favourite clicked')}
		/>
	</div>
}
