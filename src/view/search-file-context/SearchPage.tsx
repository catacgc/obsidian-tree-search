import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";
import { ResultNode } from "src/search/search";
import { SearchViewFlatten } from "../search-common/SearchViewFlatten";
import { KeyComboWrapper } from "../search-common/KeyComboWrapper";
import { ScopeProvider, useMolecule } from "bunshi/react";
import { SearchViewMolecule, SearchViewScope } from "../react-context/state";
import { SEARCH_ICON } from "../icons";
import { GlobalAppMolecule } from "../react-context/global";
import { ExpandFunctionsMolecule } from "../react-context/state";
import { molecule } from "bunshi";

type SearchPageProps = {
    sectionName: string
    showSearch?: boolean
    maxExpand?: number
    searchFn?: (q: string) => ResultNode[]
    children?: React.ReactNode
}

const SearchPageMolecule = molecule((mol, scope) => {
    return {
        ...mol(SearchViewMolecule),
        ...mol(ExpandFunctionsMolecule),
        ...mol(GlobalAppMolecule),
    }
})

const SearchPage = (props: SearchPageProps) => {
    return <ScopeProvider scope={SearchViewScope} value={{ showSearch: props.showSearch || false, isQuickLink: false, name: props.sectionName, isModal: false }}>
        <_SearchPage {...props} />
    </ScopeProvider>
}

const _SearchPage = (props: SearchPageProps) => {
    const mol = useMolecule(SearchPageMolecule)
    const { actualQueryAtom, searchVisibleAtom, updateSearchResultsAtom, scopeName, pinAtom } = mol
    const { activeFileAtom, graphVersionAtom } = mol

    const [showSearch, setShowSearch] = useAtom(searchVisibleAtom)
    const updateSearchResults = useSetAtom(updateSearchResultsAtom)
    const actualQuery = useAtomValue(actualQueryAtom)
    const setDefaultExpand = useSetAtom(mol.setDefaultExpandLevelAtom)

    const activeFile = useAtomValue(activeFileAtom)
    const version = useAtomValue(graphVersionAtom)

    useEffect(() => {
        setDefaultExpand(props.maxExpand || 0)
    }, [])

    useEffect(() => {
        if (props.searchFn) {
            const results = props.searchFn(actualQuery)
            updateSearchResults(results)
        }
    }, [version, activeFile, actualQuery, scopeName.instance])

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
