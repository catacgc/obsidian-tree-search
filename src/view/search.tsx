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

	async function refreshIndex() {
		const newIndex = await indexTree()
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
        <div className="search-row">
            <div className="search-input-container global-search-input-container">
                <input enterKeyHint="search"
					type="search"
					spellCheck="false"
					onChange={ev => setSearch(ev.target.value)}
					value={search}
					placeholder="Search..."/>
                <div className="search-input-clear-button" aria-label="Clear search" onClick={() => setSearch("")}></div>
                {/*<div className="input-right-decorator clickable-icon" aria-label="Match case">*/}
                {/*	<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"*/}
                {/*		 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"*/}
                {/*		 className="svg-icon uppercase-lowercase-a">*/}
                {/*		<path d="M10.5 14L4.5 14"></path>*/}
                {/*		<path d="M12.5 18L7.5 6"></path>*/}
                {/*		<path d="M3 18L7.5 6"></path>*/}
                {/*		<path*/}
                {/*			d="M15.9526 10.8322C15.9526 10.8322 16.6259 10 18.3832 10C20.1406 9.99999 20.9986 11.0587 20.9986 11.9682V16.7018C20.9986 17.1624 21.2815 17.7461 21.7151 18"></path>*/}
                {/*		<path*/}
                {/*			d="M20.7151 13.5C18.7151 13.5 15.7151 14.2837 15.7151 16C15.7151 17.7163 17.5908 18.2909 18.7151 18C19.5635 17.7804 20.5265 17.3116 20.889 16.6199"></path>*/}
                {/*	</svg>*/}
                {/*</div>*/}
            </div>
            <div className="float-search-view-switch">
				<div className="clickable-icon extra-setting-button" aria-label="Refresh Tree" onClick={refreshIndex}>
					<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
						 stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
						 className="lucide lucide-refresh-cw">
						<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
						<path d="M21 3v5h-5"/>
						<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
						<path d="M8 16H3v5"/>
					</svg>
				</div>
			</div>
			<div className="clickable-icon" aria-label="Search settings">
				{/*<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"*/}
				{/*	 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"*/}
				{/*	 className="svg-icon lucide-sliders-horizontal">*/}
				{/*	<line x1="21" y1="4" x2="14" y2="4"></line>*/}
				{/*	<line x1="10" y1="4" x2="3" y2="4"></line>*/}
				{/*	<line x1="21" y1="12" x2="12" y2="12"></line>*/}
				{/*	<line x1="8" y1="12" x2="3" y2="12"></line>*/}
				{/*	<line x1="21" y1="20" x2="16" y2="20"></line>*/}
				{/*	<line x1="12" y1="20" x2="3" y2="20"></line>*/}
				{/*	<line x1="14" y1="2" x2="14" y2="6"></line>*/}
				{/*	<line x1="8" y1="10" x2="8" y2="14"></line>*/}
                {/*	<line x1="16" y1="18" x2="16" y2="22"></line>*/}
                {/*</svg>*/}
            </div>
        </div>

		<div className="search-results">

		{[...Array(pages + 1)].map((_, page) => (
			<SearchPage key={page} results={results} page={page}/>
		))}

		{results.length > (pages + 1) * 10 && <button onClick={() => setPages(pages + 1)}>Next</button>}
		</div>
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
            (props.node.attrs.nodeType == "completed-task" ?
                <input type={"checkbox"} checked={true} disabled={true}/> : "↳")
        }
        <NodeRenderer
            tokens={props.node.attrs.tokens}/> {props.node.attrs.aliases.length > 0 && `(${props.node.attrs.aliases.join(", ")})`}
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




