import React, {useEffect, useState} from "react";
import {ResultNode, searchChildren, searchParents} from "../../search";
import {NotesGraph} from "../../graph";
import {SearchPage} from "../SearchPage";
import {TFile} from "obsidian";

export type FileContextProps = {
	version: number;
	graph: NotesGraph;
	activeFile: TFile;
}

export const FileContextResults: React.FC<FileContextProps> = (props) => {
	const [results, setResults] = useState<ResultNode[]>([])
	const [parents, setParents] = useState<ResultNode[]>([])
	const [pages, setPages] = useState(0)
	const graph = props.graph

	useEffect(() => {
		setParents(searchParents(graph.graph, props.activeFile))
		setResults(searchChildren(graph.graph, props.activeFile, 1))
		setPages(0)
	}, [graph, props.version, props.activeFile])

	return <>
		<h5>Parents</h5>
		<div className="search-results">
		<SearchPage searchResult={parents} page={0} pageSize={100} selectedLine={-1} key={"sp-parents"}/>
		</div>
		<h5>Children</h5>

		<div className="search-results">
			{[...Array(pages + 1)].map((_, page) => (
				<SearchPage key={`sp-ctx-${page}`} searchResult={results} page={page} pageSize={100} selectedLine={-1}/>
			))}

			{results.length > (pages + 1) * 100 && <button onClick={() => setPages(pages + 1)}>Next</button>}
		</div>
	</>
};




