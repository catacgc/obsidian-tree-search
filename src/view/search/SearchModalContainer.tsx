import {useAtom, useAtomValue, useSetAtom} from "jotai";
import {useEffect} from "react";
import {advancedSearch, searchIndex} from "../../search/search";
import {SearchModalMolecule, SearchViewMolecule, SearchViewScope,} from "../react-context/state";
import {SearchViewFlatten} from "./SearchViewFlatten";
import {settingsAtom} from "../react-context/settings";
import {Platform} from "obsidian";
import {ScopeProvider, useMolecule} from "bunshi/react";
import {GlobalAtoms} from "../react-context/global";
import {KeyComboWrapper} from "./KeyComboWrapper";

export const SearchModalContainer = ({ isQuickLink = false }: { isQuickLink?: boolean }) => {

    return <ScopeProvider scope={SearchViewScope} value={{name: "modal", isQuickLink, showSearch: true, isModal: true}}>
        <KeyComboWrapper>
            <_SearchModalContainer isQuickLink={isQuickLink}/>
        </KeyComboWrapper>
    </ScopeProvider>
}

export const _SearchModalContainer = ({ isQuickLink = false }: { isQuickLink?: boolean }) => {

    // const graph = useAtomValue(GlobalAtoms.graphAtom)
    // const version = useAtomValue(GlobalAtoms.graphVersionAtom)

    const { searchResultsComputeAtom } = useMolecule(SearchModalMolecule)

    // const {actualQueryAtom, updateSearchResultsAtom} = useMolecule(SearchViewMolecule)

    // const { searchSeparator } = useAtomValue(settingsAtom);
    //
    // const setResult = useSetAtom(updateSearchResultsAtom)
    // const searchQuery = useAtomValue(actualQueryAtom)

    const height = (Platform.isMobile || Platform.isTablet) ? "100vh" : "calc(100vh * 0.75)"

    // useEffect(() => {
    //     const search = (isQuickLink && searchQuery.length > 0) ? `${searchQuery} . :page | :header` : searchQuery
    //
    //     const results = searchIndex(graph.graph, search, searchSeparator)
    //     setResult(results)
    // }, [searchQuery, version, searchSeparator, isQuickLink])

    useAtom(searchResultsComputeAtom)

    return <div style={{height: height}}>
            <div className="flex flex-col w-full h-full">
                <SearchViewFlatten/>
            </div>
        </div>;
};
