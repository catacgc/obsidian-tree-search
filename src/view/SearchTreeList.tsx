import {ResultNode} from "../search";
import {NodeView} from "./NodeView";

export const SearchTreeList = (props: { node: ResultNode, level: number }) => {

	return <div className={props.level == 0 ? "search-tree-container" : ""}>
		<div className={"tree-node indent-" + props.level} style={{paddingLeft: props.level * 10 + "px"}}>
			<NodeView node={props.node} index={props.level} key={props.node.value}/>
		</div>

		<div className={"sub-tree indent-" + props.level}>
			{props.node.children.map(child => <SearchTreeList node={child} level={props.level + 1} key={child.value}/>)}
		</div>
	</div>
}
