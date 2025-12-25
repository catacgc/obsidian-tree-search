import React from "react";
import { SEARCH_ICON, REFRESH_ICON } from "../icons";
import { useUrlOpener } from "./useUrlOpener";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { molecule, useMolecule } from "bunshi/react";
import { ExpandFunctionsMolecule, SearchViewMolecule, SearchViewScope } from "../react-context/state";
import { GlobalAppMolecule } from "../react-context/global";
import { GlobalSearchMolecule } from "../react-context/state";
import { atom } from "jotai/index";

export type SearchBarProps = {
    isQuickLink: boolean
}

export const SearchBarMolecule = molecule((mol, scope) => {
    scope(SearchViewScope)
    const { searchResultsStateAtom } = mol(SearchViewMolecule)
    const { graphAtom } = mol(GlobalAppMolecule)

    const searchPlaceholderAtom = atom((get) => {
        const { totalNodes } = get(searchResultsStateAtom)
        const graph = get(graphAtom)
        if (totalNodes > 0) {
            return `Filter ${totalNodes} nodes`
        }

        return `Search ${graph.graph.nodes().length} nodes and ${graph.graph.edges().length} edges`
    })

    return {
        searchPlaceholderAtom,
        ...mol(SearchViewMolecule),
        ...mol(ExpandFunctionsMolecule),
        ...mol(GlobalAppMolecule),
    }
})

export const SearchBar = ({ isQuickLink }: SearchBarProps) => {
    const mol = useMolecule(SearchBarMolecule)

    const { isGraphLoadingAtom } = mol
    const { searchPlaceholderAtom } = mol
    const { lastSearchAtom, searchQueryAtom } = mol
    const { resetCollapseAtom, getExpandLevel, incExpandAtom, decExpandAtom } = mol

    const decExpand = useSetAtom(decExpandAtom)
    const incExpand = useSetAtom(incExpandAtom)
    const resetCollapse = useSetAtom(resetCollapseAtom)
    const setLoading = useSetAtom(isGraphLoadingAtom)

    const handleRefresh = () => setLoading(true)

    const searchPlaceholder = useAtomValue(searchPlaceholderAtom)

    const expandLevel = useAtomValue(getExpandLevel)

    const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom)
    const saveLastSearch = useSetAtom(lastSearchAtom)

    const setSearch = (search: string) => {
        setSearchQuery({ query: search })
        saveLastSearch({ query: search })
    }

    const { linkRef, tryOpenUrl } = useUrlOpener()

    return <>
        <a style={{ display: "none" }} target="_blank" ref={linkRef} href="#"></a>
        <div className="tw-reset sticky top-0 z-10">

            <div className="relative flex items-center flex-1">
                <div className="flex items-center justify-between w-full max-w-4xl">
                    <div className="relative flex-1">
                        <input
                            enterKeyHint="search"
                            type="search"
                            spellCheck="false"
                            onChange={ev => setSearch(ev.target.value)}
                            // onKeyDown={handleKeyDown}
                            value={searchQuery.query}
                            placeholder={searchPlaceholder}
                            className="w-full pl-5 ml-1 mb-2 mt-2 pr-16 py-3
                        rounded-lg border focus:border-obs-hover hover:border-obs-hover focus:ring-0
                        outline-none transition-all duration-150
                        bg-obs-base-0
                        "
                        />

                        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center space-x-1">
                            <button
                                className="text-obs-base-40 focus:outline-none hover:text-obs-accent bg-transparent border-none p-1"
                                aria-label="Search"
                                onClick={() => {/* Search action can be added here if needed */ }}
                            >
                                <SEARCH_ICON />
                            </button>

                            <button
                                className="text-obs-base-40 focus:outline-none hover:text-obs-accent bg-transparent border-none p-1"
                                aria-label="Clear search"
                                onClick={() => setSearch("")}
                            >
                                ×
                            </button>
                        </div>
                    </div>

                    <div className="ml-2 flex items-center space-x-1">
                        <button className="bg-transparent border-none p-1 text-obs-base-40 hover:text-obs-accent focus:outline-none clickable-icon" aria-label="Collapse results" onClick={decExpand}>-</button>
                        <button className="bg-transparent border-none p-1 text-obs-base-40 hover:text-obs-accent focus:outline-none clickable-icon" aria-label="Collapse to zero" onClick={resetCollapse}> {expandLevel} </button>
                        <button className="bg-transparent border-none p-1 text-obs-base-40 hover:text-obs-accent focus:outline-none clickable-icon" aria-label="Expand results" onClick={incExpand}>+</button>
                        <button className="bg-transparent border-none p-1 text-obs-base-40 hover:text-obs-accent focus:outline-none clickable-icon" aria-label="Refresh Tree" onClick={handleRefresh}>
                            <REFRESH_ICON />
                        </button>
                    </div>
                </div>

            </div>

        </div>
    </>
} 
