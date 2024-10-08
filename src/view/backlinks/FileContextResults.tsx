import React, {useCallback, useEffect, useState} from "react";
import {advancedSearch, index, ResultNode, searchChildren, searchParents, SearchQuery} from "../../search";
import {SearchPage} from "../SearchPage";
import {TFile} from "obsidian";
import {useGraph} from "../react-context/GraphContext";
import {SearchView} from "../search/SearchView";

export type FileContextProps = {
	activeFile: TFile;
}

export const FileContextResults: React.FC<FileContextProps> = (props) => {
	const [parents, setParents] = useState<ResultNode[]>([])
    const {graph, version} = useGraph();

    const [showSearch, setShowSearch] = useState(false)

	useEffect(() => {
		setParents(searchParents(graph.graph, props.activeFile))
    }, [graph, version, props.activeFile])

    const search = useCallback((query: SearchQuery) => {
        if (query.query.length < 3) {
            return index(searchChildren(graph.graph, props.activeFile, 1))
        }

        const searchResults = advancedSearch(graph.graph, props.activeFile,
            2,
            "",
            query.query)

        return index(searchResults)
    }, [graph, version, props.activeFile, showSearch])

	return <>
		<h5>Parents</h5>
		<div className="search-results">
		<SearchPage searchResult={parents} page={0} pageSize={100} selectedLine={-1} key={"sp-parents"}/>
		</div>
		<h5 onClick={() => setShowSearch(!showSearch)}>Children</h5>

        <SearchView searchFunction={search} showSearch={showSearch} context={props.activeFile.basename}></SearchView>
	</>
};




