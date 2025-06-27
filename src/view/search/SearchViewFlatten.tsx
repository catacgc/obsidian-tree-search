import {useAtomValue, useSetAtom} from "jotai";
import {ParsedNode} from "../../graph";
import {useMolecule} from "bunshi/react";
import {SearchViewMolecule} from "../react-context/state";
import {SearchTreeNode} from "../SearchTreeNode";
import {SearchBar} from "./SearchBar";
import {SearchActions} from "./SearchActions";
import React from "react";

export type TreeNode = {
    node: ParsedNode,
    indent: number,
    hasChildren: boolean
    visible: boolean
    selected: boolean
    index: number
}

export const SearchViewFlatten = () => {
    const {searchViewStateAtom, incrementPagesAtom} = useMolecule(SearchViewMolecule)

    const viewState = useAtomValue(searchViewStateAtom)
    const incrementPages = useSetAtom(incrementPagesAtom)

    return <>
        {(viewState.showSearch) && <div className="tw-reset bg-obs-base-0 rounded-sm border border-gray-200">
                <SearchBar isQuickLink={viewState.isQuickLink}/>

                <div className="sticky top-0 z-10">
                    <SearchActions />
                </div>
            </div>
        }

        <div className="flex-1 overflow-y-auto">
            {viewState.isLoading ? (
                <LoadingDots />
            ) : (
                <>
                    {viewState.searchResults.renderableNodes.map((tree, index) => {
                        return <SearchTreeNode node={tree} key={`${index}`} />
                    })}
                    {viewState.searchResults.hasMore && (
                        <div className="flex justify-center items-center py-4">
                            <button
                                onClick={incrementPages}
                                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors duration-200"
                            >
                                Load More
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>

    </>
};

const LoadingDots = () => {
    return <div className="flex justify-center items-center space-x-1 text-6xl font-bold text-gray-600 dark:text-gray-300">
        <span className="animate-bounce [animation-delay:-0.3s]">.</span>
        <span className="animate-bounce [animation-delay:-0.15s]">.</span>
        <span className="animate-bounce">.</span>
    </div>
}
