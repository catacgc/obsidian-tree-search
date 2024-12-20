import { createStore, Provider, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { ResultNode } from "src/search";
import { activeFileAtom } from "./file-context/FileContextComponent";
import { actualQueryAtom, graphVersionAtom, setDefaultExpandLevelAtom, updateSearchResultsAtom } from "./react-context/state";
import { SearchViewFlatten } from "./search/SearchViewFlatten";

type SearchPageProps = {
    sectionName: string
    showSearch?: boolean
    maxExpand?: number
    searchFn: (q: string) => ResultNode[]
}

const SearchPage = (props: SearchPageProps) => {
    const childItemSearchStore = useMemo(() => createStore(), [])
    const [showSearch, setShowSearch] = useState(false)
    const updateSearchResults = useSetAtom(updateSearchResultsAtom, {store: childItemSearchStore})
    const actualQuery = useAtomValue(actualQueryAtom, {store: childItemSearchStore})
    const setDefaultExpand = useSetAtom(setDefaultExpandLevelAtom, {store: childItemSearchStore})

    useEffect(() => {
        setDefaultExpand(props.maxExpand || 0)
    }, [])

    const activeFile = useAtomValue(activeFileAtom)
    const version = useAtomValue(graphVersionAtom)

    useEffect(() => {
        const results = props.searchFn(actualQuery)
        updateSearchResults(results)
    }, [version, activeFile, actualQuery])

    return <Provider store={childItemSearchStore}>
        <h5 onClick={() => setShowSearch(!showSearch)}>{props.sectionName}</h5>
        <SearchViewFlatten showSearch={showSearch}></SearchViewFlatten>
    </Provider>
}

export default SearchPage