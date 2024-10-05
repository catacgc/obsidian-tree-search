import {ResultNode} from "../search";
import {SearchTreeList} from "./SearchTreeList";

type SearchPageProps = {
	searchResult: ResultNode[],
	page: number,
	pageSize: number,
	selectedLine: number,
	selectHoveredLine?: (line: number) => void
};

export const NO_OP = (_: number) => {
};

export const SearchPage = (props: SearchPageProps) => {

	return <>
		<div className="cm-content tree-search-page">
			<div className="markdown-source-view mod-cm6 is-live-preview">
				{props.searchResult.slice(props.page * props.pageSize, (props.page + 1) * props.pageSize).map((tree, index) =>
					<SearchTreeList node={tree} level={0} key={`${index}`} selectedLine={props.selectedLine}
									selectHoveredLine={props.selectHoveredLine || NO_OP}/>
				)
				}
			</div>
		</div>
	</>
}
