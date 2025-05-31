import { createStore, Provider, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { ResultNode } from "src/search/search";
import { activeFileAtom } from "./file-context/FileContextComponent";
import { actualQueryAtom, graphVersionAtom, setDefaultExpandLevelAtom, updateSearchResultsAtom } from "./react-context/state";
import { SearchViewFlatten } from "./search/SearchViewFlatten";

type SearchPageProps = {
    sectionName: string
    showSearch?: boolean
    maxExpand?: number
    searchFn: (q: string) => ResultNode[]
    children?: React.ReactNode
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
        <div onClick={() => setShowSearch(!showSearch)}>
            {props.children}
            {props.sectionName && <h5>{props.sectionName}</h5>}
        </div>
        <SearchViewFlatten showSearch={showSearch}></SearchViewFlatten>
    </Provider>
}

export default SearchPage