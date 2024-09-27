import {ResultNode} from "../search";
import {SearchTreeList} from "./SearchTreeList";

export const SearchPage = (props: { results: ResultNode[], page: number }) => {

	return <>
		{props.results.slice(props.page * 10, (props.page + 1) * 10).map(tree =>
			<div>
				<div className="search-tree-separator"></div>
				<SearchTreeList node={tree} level={0} key={`${tree.value}`}/>
			</div>)
		}
	</>
}
