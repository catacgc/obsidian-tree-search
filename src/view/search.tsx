import {Index, indexTree, NodeAttributes} from "src/tree-builder";
import {useEffect, useState} from "react";
import {useApp} from "./hooks";
import {openFileAndHighlightLine} from "src/obsidian-utils";
import {ResultNode, searchIndex} from "../search";
import Markdown from "react-markdown";


export const SearchView = ({index}: { index: Index }) => {
	const [idx, setIdx] = useState(index)
	const [search, setSearch] = useState("")
	const [results, setResults] = useState<ResultNode[]>([])
	const [pages, setPages] = useState(0)

	function refreshIndex() {
		const newIndex = indexTree()
		newIndex && setIdx(newIndex)
	}

	useEffect(() => {
		setResults(searchIndex(idx, search))
		setPages(0)
	}, [search, idx])

	return <>
		<h4>Search Tree</h4>
		<input type="text" placeholder="Filter..." onChange={ev => setSearch(ev.target.value)}/>
		<button onClick={refreshIndex}>↺</button>

		{[...Array(pages + 1)].map((_, page) => (
			<SearchPage key={page} results={results} page={page}/>
		))}

		{results.length > (pages + 1) * 10 && <button onClick={() => setPages(pages + 1)}>Next</button>}
	</>
};

export const SearchPage = (props: {results: ResultNode[], page: number}) => {

	return <>
		{props.results.slice(props.page * 10, (props.page + 1) * 10).map(tree =>
			<SearchTreeList node={tree} level={0} key={`${tree.value}`}/>)}
	</>
}

export const SearchTreeList = (props: { node: ResultNode, level: number }) => {

	return <div style={{marginLeft: props.level * 10 + "px"}}>
		<NodeView node={props.node} index={props.level} key={props.node.value}/>

		<div>
			{props.node.children.map(child => <SearchTreeList node={child} level={props.level + 1} key={child.value}/>)}
		</div>
	</div>
}

export const NodeView = (props: { node: ResultNode, index: number }) => {
	const app = useApp()

	async function openFile(attrs: NodeAttributes) {
		if (app == undefined) return
		await openFileAndHighlightLine(app, attrs.location.path, attrs.location.line)
	}

	const attrs = props.node.attrs

	const text = attrs.fullMarkdownText
		.replace("![[", "[[")
		.replace(
`[[${attrs.parsed.page}]]`,
`[${attrs.parsed.page}](#)`
		)

	return <div
		className="search-result-file-match better-search-views-file-match markdown-preview-view markdown-rendered"
		onClick={() => openFile(attrs)}
	>
		<Markdown>{`${props.index + 1}. ${text}`}</Markdown>
	</div>
}



