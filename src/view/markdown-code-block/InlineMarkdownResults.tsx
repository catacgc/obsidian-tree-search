import React, {useEffect, useState} from "react";
import {ResultNode, searchChildren} from "../../search";
import {SearchPage} from "../SearchPage";
import {TFile} from "obsidian";
import {useGraph} from "../react-context/GraphContext";
import {MarkdownContextSettings} from "./ContextCodeBlock";

export type InlineMarkdownResultsProps = {
	activeFile: TFile;
	heading?: string;
    settings: MarkdownContextSettings
}

export const InlineMarkdownResults: React.FC<InlineMarkdownResultsProps> = (props) => {
	const [results, setResults] = useState<ResultNode[]>([])
	const [pages, setPages] = useState(0)
	const {graph, version} = useGraph()
	const children = props.heading ? props.activeFile.basename + ' > ' + props.heading : props.activeFile.basename;

	useEffect(() => {
		setResults(searchChildren(graph.graph, props.activeFile, props.settings.depth, props.heading))
		setPages(0)
	}, [graph, version, props.activeFile, props.heading])

	return <>
		<div className="tree-search-header-container">
			<div className="tree-search-header">{children} Children</div>
		</div>

		<div className="search-results">
			{[...Array(pages + 1)].map((_, page) => (
				<SearchPage key={`sp-ctx-${page}`} searchResult={results} page={page} pageSize={100} selectedLine={-1}/>
			))}

			{results.length > (pages + 1) * 100 && <button onClick={() => setPages(pages + 1)}>Next</button>}
		</div>
	</>
};




