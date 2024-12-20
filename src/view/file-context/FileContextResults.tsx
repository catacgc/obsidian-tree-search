import { getDefaultStore, useAtomValue } from "jotai";
import { useCallback } from "react";
import { advancedSearch, flattenTasks, searchParents } from "../../search";
import { graphAtom, graphVersionAtom } from "../react-context/state";
import SearchPage from "../SearchPage";
import { activeFileAtom } from "./FileContextComponent";
import { settingsAtom } from "../react-context/settings";


export const FileContextResults = () => {
    const graph = useAtomValue(graphAtom, {store: getDefaultStore()})
    const version = useAtomValue(graphVersionAtom)
    const activeFile = useAtomValue(activeFileAtom)
    const settings = useAtomValue(settingsAtom)

	const searchParentsFn = useCallback((q: string) => {
        if (activeFile === undefined) {
            return []
        }

		return searchParents(graph.graph, activeFile)
    }, [graph, version, activeFile])

    const searchForActiveFile = useCallback((query: string) => {
        if (activeFile === undefined) {
            return []
        }

        const searchResults = advancedSearch(
            graph.graph, 
            activeFile,
            1000,
            "",
            query
        )

        return searchResults;
    }, [graph, version, activeFile])

    const searchTasks = useCallback((query: string) => {
        if (activeFile === undefined) {
            return []
        }

        const searchResults = advancedSearch(
            graph.graph, 
            activeFile,
            1000,
            "",
            query 
        )

        return flattenTasks(searchResults).nodes
    }, [graph, version, activeFile])
    

	return <>
        <SearchPage searchFn={searchParentsFn} sectionName="Parents"/>
        <SearchPage searchFn={searchForActiveFile} sectionName="Children" maxExpand={1}/>
        <SearchPage searchFn={searchTasks} sectionName="Tasks"/>
    </>
};