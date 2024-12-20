import { getDefaultStore, useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";
import { searchIndex } from "../../search";
import { actualQueryAtom, graphAtom, graphVersionAtom, isGraphLoadingAtom, updateSearchResultsAtom } from "../react-context/state";
import { SearchInstructionsAndNav } from "./SearchInstructionsAndNav";
import { SearchViewFlatten } from "./SearchViewFlatten";
import { settingsAtom } from "../react-context/settings";


export const SearchModalContainer = ({ refresh = true }: { refresh?: boolean }) => {

    const graph = useAtomValue(graphAtom, {store: getDefaultStore()})
    const version = useAtomValue(graphVersionAtom, {store: getDefaultStore()})

    const { searchSeparator } = useAtomValue(settingsAtom);
    const setIsLoading = useSetAtom(isGraphLoadingAtom, {store: getDefaultStore()})

    const setResult = useSetAtom(updateSearchResultsAtom)
    const searchQuery = useAtomValue(actualQueryAtom)

    useEffect(() => {
        // try refreshing the graph; nodes count is a good proxy
        if (graph.graph.nodes().length > 0 || !refresh) return;

        const interval = setInterval(() => {
            if (graph.graph.nodes().length === 0) setIsLoading(true)
        }, 2000, 5);

        return () => clearInterval(interval);
    }, [version, refresh]);

    useEffect(() => {
        const results = searchIndex(graph.graph, searchQuery, searchSeparator)
        setResult(results)
    }, [searchQuery, version, searchSeparator])

    return <div className="search-container-modal">
            <div className="search-container-modal-middle">
                <SearchViewFlatten/>
            </div>

            <SearchInstructionsAndNav />
        </div>;
};
