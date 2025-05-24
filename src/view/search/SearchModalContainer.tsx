import { getDefaultStore, useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";
import { advancedSearch, searchIndex } from "../../search/search";
import { actualQueryAtom, graphAtom, graphVersionAtom, isGraphLoadingAtom, updateSearchResultsAtom } from "../react-context/state";
import { SearchInstructionsAndNav } from "./SearchInstructionsAndNav";
import { SearchViewFlatten } from "./SearchViewFlatten";
import { settingsAtom } from "../react-context/settings";
import { activeFileAtom } from "../file-context/FileContextComponent";


export const SearchModalContainer = ({ refresh = true, isQuickLink = false }: { refresh?: boolean, isQuickLink?: boolean }) => {

    const graph = useAtomValue(graphAtom, {store: getDefaultStore()})
    const version = useAtomValue(graphVersionAtom, {store: getDefaultStore()})

    const { searchSeparator } = useAtomValue(settingsAtom);

    const setResult = useSetAtom(updateSearchResultsAtom)
    const searchQuery = useAtomValue(actualQueryAtom)
    const activeFile = useAtomValue(activeFileAtom, {store: getDefaultStore()})

    useEffect(() => {
        const search = (isQuickLink && searchQuery.length > 0) ? `${searchQuery} . :page | :header` : searchQuery

        if (search.length === 0 && activeFile) {
            const results = advancedSearch(graph.graph, `[[${activeFile.basename}]]`, searchQuery, searchSeparator)
            setResult(results)
        } else {
            const results = searchIndex(graph.graph, search, searchSeparator)
            setResult(results)
        }
    }, [searchQuery, version, searchSeparator, isQuickLink, activeFile])

    return <div style={{height: "calc(100vh * 0.75)"}}>
            <div className="flex flex-col w-full h-full">

            <SearchViewFlatten isQuickLink={isQuickLink}/>

            {!isQuickLink && (
                <div className="sticky bottom-0 z-10">
                    <SearchInstructionsAndNav />
                </div>
            )}
            </div>
        </div>;
};