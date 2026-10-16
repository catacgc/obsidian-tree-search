import {useAtom, useAtomValue, useSetAtom} from "jotai";
import {useEffect} from "react";
import {ResultNode} from "@mdtree/core";
import {SearchViewFlatten} from "./search/SearchViewFlatten";
import {KeyComboWrapper} from "./search/KeyComboWrapper";
import {ScopeProvider, useMolecule} from "bunshi/react";
import {SearchViewMolecule, SearchViewScope} from "./react-context/state";
import {GlobalAtoms} from "./react-context/global";
import {SEARCH_ICON} from "./icons";

type SearchPageProps = {
    sectionName: string
    showSearch?: boolean
    maxExpand?: number
    searchFn?: (q: string) => ResultNode[]
    allowTimeline?: boolean
    allowEditing?: boolean
    children?: React.ReactNode
}
const SearchPage = (props: SearchPageProps) => {
    return <ScopeProvider scope={SearchViewScope} value={{showSearch: props.showSearch || false, isQuickLink: false, name: props.sectionName, isModal: false, allowTimeline: props.allowTimeline ?? false, allowEditing: props.allowEditing ?? false}}>
        <_SearchPage {...props}/>
    </ScopeProvider>
}

const _SearchPage = (props: SearchPageProps) => {
    const { actualQueryAtom, searchTextAtom, searchVisibleAtom, setDefaultExpandLevelAtom, updateSearchResultsAtom, scopeName,
        chainAtom, refreshChainResultsAtom, outlineAtom, refreshOutlineResultsAtom } = useMolecule(SearchViewMolecule)
    const [pin, setPin] = useAtom(GlobalAtoms.pinAtom);

    const [showSearch, setShowSearch] = useAtom(searchVisibleAtom)
    const updateSearchResults = useSetAtom(updateSearchResultsAtom)
    const actualQuery = useAtomValue(actualQueryAtom)
    const searchText = useAtomValue(searchTextAtom)
    const chain = useAtomValue(chainAtom)
    const refreshChainResults = useSetAtom(refreshChainResultsAtom)
    const outline = useAtomValue(outlineAtom)
    const refreshOutlineResults = useSetAtom(refreshOutlineResultsAtom)
    const setDefaultExpand = useSetAtom(setDefaultExpandLevelAtom)

    useEffect(() => {
        setDefaultExpand(props.maxExpand || 0)
    }, [])

    const activeFile = useAtomValue(GlobalAtoms.activeFileAtom)
    const version = useAtomValue(GlobalAtoms.graphVersionAtom)

    useEffect(() => {
        if (chain) {
            refreshChainResults()
            return
        }
        if (outline) {
            refreshOutlineResults()
            return
        }
        if (props.searchFn) {
            const results = props.searchFn(searchText)
            console.debug("Set results: ", version, scopeName, results)
            updateSearchResults(results)
        }
    }, [version, activeFile, actualQuery, searchText, scopeName.instance, chain, outline])

    return <>
        <KeyComboWrapper>
            <div className="flex items-center justify-between hover:text-obs-accent" onClick={() => setShowSearch(!showSearch)}>
                <div>
                    {props.children}
                    {props.sectionName && <h5>{props.sectionName}</h5>}
                </div>
                <button
                    className="bg-transparent border-none p-1 text-obs-base-40 hover:text-obs-accent focus:outline-none clickable-icon"
                    aria-label="Toggle search"
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowSearch(!showSearch);
                    }}
                >
                    <SEARCH_ICON />
                </button>
            </div>
            <SearchViewFlatten></SearchViewFlatten>
        </KeyComboWrapper>
    </>
}

export default SearchPage
