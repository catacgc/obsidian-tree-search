// The inline editor's `[[` autocomplete (EDITOR.md §3.4): useLinkSuggest tracks the open
// `[[query` in a text field; LinkResults draws its matches as Search results below the editor,
// or today's daily outline while no `[[` is open.
import React, {useEffect, useState} from "react";
import {useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {SearchViewMolecule} from "../react-context/state";
import {SearchTreeNode} from "../SearchTreeNode";
import type {TreeNode} from "../search/SearchViewFlatten";
import {linkQueryAt} from "./textarea-ops";

export type LinkSuggestState = {
    open: boolean
    start: number
    query: string
    dismiss: () => void
}

/** Suggestion state for the `[[query` before `caret`; `active` is false while the field is unfocused. */
export function useLinkSuggest(text: string, caret: number, active: boolean): LinkSuggestState {
    const [dismissedStart, setDismissedStart] = useState<number | null>(null)

    const at = active ? linkQueryAt(text, caret) : null
    const start = at?.start ?? -1
    const query = at?.query ?? ""

    useEffect(() => { if (start < 0) setDismissedStart(null) }, [start])

    return {
        open: start >= 0 && start !== dismissedStart,
        start,
        query,
        dismiss: () => setDismissedStart(start),
    }
}

/** The `[[` autocomplete as Search results: Quick Add's link-target tree (SearchModalMolecule, query = the open
 *  `[[query`), or the daily outline (DAILY_OUTLINE_QUERY) when none is open, drawn with SearchTreeNode. */
export function LinkResults({open, query, onPick}: { open: boolean; query: string; onPick: (row: TreeNode) => void }) {
    const {renderableTreeNodesAtom, hasMoreTreeNodesAtom, incrementPagesAtom} = useMolecule(SearchViewMolecule)
    const rows = useAtomValue(renderableTreeNodesAtom)
    const hasMore = useAtomValue(hasMoreTreeNodesAtom)
    const incrementPages = useSetAtom(incrementPagesAtom)

    const empty = !open ? (rows.length === 0 ? "Today's daily note has no outline yet" : null)
        : query.length < 3 ? "Type 3+ characters"
        : rows.length === 0 ? "No matching notes"
        : null

    return <div className="flex-1 overflow-y-auto ts-link-results">
        {empty !== null ? <div className="ts-link-results-empty">{empty}</div> : <>
            {rows.map((row, pos) => <SearchTreeNode node={row} key={pos} pos={pos} onPick={onPick}/>)}
            {hasMore && (
                <div className="flex justify-center items-center py-4">
                    <button
                        onMouseDown={ev => ev.preventDefault()}
                        onClick={incrementPages}
                        className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors duration-200"
                    >
                        Load More
                    </button>
                </div>
            )}
        </>}
    </div>
}
