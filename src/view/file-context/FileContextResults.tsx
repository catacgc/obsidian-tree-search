import React, {useCallback, useEffect, useState} from "react";
import {advancedSearch, flattenTasks, index, ResultNode, searchChildren, searchParents, SearchQuery} from "../../search";
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

    const searchTasks = useCallback((query: SearchQuery) => {
        const searchResults = advancedSearch(graph.graph, props.activeFile,
            30,
            "",
            ":task")

        return flattenTasks(searchResults)
    }, [graph, version, props.activeFile, showSearch])

    const search = useCallback((query: SearchQuery) => {
        if (query.query.length < 3) {
            return index(searchChildren(graph.graph, props.activeFile, 5))
        }

        const searchResults = advancedSearch(graph.graph, props.activeFile,
            5,
            "",
            query.query)

        return index(searchResults)
    }, [graph, version, props.activeFile, showSearch])

	return <>
        <h5>Parents</h5>
        <div className="search-results">
            <SearchPage searchResult={parents} page={0} 
                minExpand={1}
                pageSize={100} selectedLine={-1} key={"sp-parents"}
            />
        </div>
        <h5 onClick={() => setShowSearch(!showSearch)}>Children</h5>

        <SearchView minExpand={1} searchFunction={search} showSearch={showSearch} context={props.activeFile.basename}></SearchView>

        <h5>Tasks</h5>

        <SearchView minExpand={1} pageSize={10} showSearch={false} searchFunction={searchTasks} context={props.activeFile.basename}></SearchView>
    </>
};