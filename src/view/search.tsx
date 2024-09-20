import {Index, indexTree} from "src/tree-builder";
import {useEffect, useState} from "react";
import {useApp} from "./hooks";
import {openFileAndHighlightLine} from "src/obsidian-utils";
import {ResultNode, searchIndex} from "../search";
import {Token} from "markdown-it";
import {NodeAttributes} from "src/graph";

export const SearchView = () => {
	const [idx, setIdx] = useState<Index>()
	const [search, setSearch] = useState("")
	const [results, setResults] = useState<ResultNode[]>([])
	const [pages, setPages] = useState(0)

	function refreshIndex() {
		const newIndex = indexTree()
		newIndex && setIdx(newIndex)
	}

	useEffect(() => {
		refreshIndex()
	}, []);

	useEffect(() => {
		if (!idx) return

		setResults(searchIndex(idx.graph.graph, search))
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

export const SearchPage = (props: { results: ResultNode[], page: number }) => {

	return <>
		{props.results.slice(props.page * 10, (props.page + 1) * 10).map(tree =>
			<SearchTreeList node={tree} level={0} key={`${tree.value}`}/>)}
	</>
}

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

export const NodeView = (props: { node: ResultNode, index: number }) => {
	const app = useApp()

	async function openFile(attrs: NodeAttributes) {
		if (app == undefined) return
		await openFileAndHighlightLine(app, attrs.location.path, attrs.location.position.start, attrs.location.position.end)
	}

	const attrs = props.node.attrs

	return <div
		className="search-tree-node"
		onClick={() => openFile(attrs)}
	>
		{props.node.attrs.nodeType == "task" ? <input type={"checkbox"} disabled={true}/> :
			(props.node.attrs.nodeType == "completed-task" ? <input type={"checkbox"} checked={true} disabled={true}/> : "↳")
		}
		<NodeRenderer tokens={props.node.attrs.tokens}/> {props.node.attrs.aliases.length > 0 && `(${props.node.attrs.aliases.join(", ")})`}
	</div>
}

export const NodeRenderer = (props: { tokens: Token[] }) => {
	const tokens = props.tokens

	if (tokens.length == 0) return <></>

	const token = tokens[0]

	if (token.type == "inline" && token.children) {
		return <NodeRenderer tokens={token.children}/>
	}

	if (token.type == "obsidian_link") {
		return <>
			<a className={"obsidian-link"} href="#" onClick={ev => ev.preventDefault()}>{token.content}</a>
			<NodeRenderer tokens={tokens.slice(1)}/>
		</>
	}

	if (token.type == "link_open") {
		const href = token.attrs?.[0]?.[1] || "#"
		const content = tokens[1]?.content
		return <>
			<a className={"external-link"} href={href}>{content}</a>
			<NodeRenderer tokens={tokens.slice(2)}/>
		</>
	}

	if (token.type == "link_close") {
		return <NodeRenderer tokens={tokens.slice(1)}/>
	}

	if (token.type == "text") {
		return <>
			<span>{token.content}</span>
			<NodeRenderer tokens={tokens.slice(1)}/>
		</>
	}

	if (token.type == "strong_open") {
		return <b>
			<NodeRenderer tokens={tokens.slice(1)}/>
		</b>
	}

	if (token.type == "strong_close") {
		return <NodeRenderer tokens={tokens.slice(1)}/>
	}

	if (token.type == "em_open") {
		return <em><NodeRenderer tokens={tokens.slice(1)}/></em>
	}

	if (token.type == "softbreak") {
		return <NodeRenderer tokens={tokens.slice(1)}/>
	}

	if (token.type == "s_open") {
		return <s><NodeRenderer tokens={tokens.slice(1)}/></s>
	}

	// if (!token.type.includes("_close")) console.log("tokens not rendered: ", tokens)

	return <NodeRenderer tokens={tokens.slice(1)}/>
}




