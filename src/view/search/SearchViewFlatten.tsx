import {useAtomValue, useSetAtom} from "jotai";
import {ParsedNode} from "@mdtree/core";
import {useMolecule} from "bunshi/react";
import {SearchViewMolecule} from "../react-context/state";
import {SearchTreeNode} from "../SearchTreeNode";
import {SearchBar} from "./SearchBar";
import {SearchActions} from "./SearchActions";
import {SearchHelp} from "./SearchHelp";
import {TimelineFilterBar, TimelineRow} from "./SearchTimeline";
import React, {useEffect} from "react";

export type TreeNode = {
    node: ParsedNode,
    indent: number,
    hasChildren: boolean
    visible: boolean
    selected: boolean
    index: number
    matched: boolean
    archived?: boolean
    timeline?: { breadcrumb: ParsedNode[]; pinned: boolean; ageDays: number }
}

export const SearchViewFlatten = () => {
    const {searchViewStateAtom, incrementPagesAtom, timelineActiveAtom, timelineWindowAtom, rebuildResultsAtom, actualQueryAtom} = useMolecule(SearchViewMolecule)

    const viewState = useAtomValue(searchViewStateAtom)
    const incrementPages = useSetAtom(incrementPagesAtom)
    const timelineActive = useAtomValue(timelineActiveAtom)
    const timelineWindow = useAtomValue(timelineWindowAtom)
    const actualQuery = useAtomValue(actualQueryAtom)
    const rebuild = useSetAtom(rebuildResultsAtom)

    // Re-project the stored results when the mode (possibly flipped from another
    // open view) or the recency window changes; idempotent on mount.
    useEffect(() => { rebuild() }, [timelineActive, timelineWindow])

    return <>
        {(viewState.showSearch) && <div className="tw-reset bg-obs-base-0 rounded-sm border border-gray-200">
                <SearchBar isQuickLink={viewState.isQuickLink}/>
                {timelineActive && <TimelineFilterBar/>}

                <div className="sticky top-0 z-10">
                    <SearchActions />
                </div>
            </div>
        }

        <div className="flex-1 overflow-y-auto">
            {viewState.isLoading ? (
                <LoadingDots />
            ) : viewState.searchResults.renderableNodes.length === 0 ? (
                timelineActive && actualQuery.trim().length >= 3
                    ? <div className="ts-timeline-empty">No dated matches{timelineWindow !== "all" ? ` in the last ${timelineWindow}` : ""}</div>
                    // Only the main search modal shows the syntax cheat sheet; auxiliary
                    // panes (file context, parents, tasks, inline results) stay blank.
                    : viewState.isModal ? <SearchHelp /> : null
            ) : (
                <>
                    {viewState.searchResults.renderableNodes.map((tree, index) => timelineActive
                        ? <TimelineRow node={tree} key={`${index}`} />
                        : <SearchTreeNode node={tree} key={`${index}`} />
                    )}
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
