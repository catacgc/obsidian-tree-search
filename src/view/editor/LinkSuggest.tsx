// Compact Insert Link tree for the inline editor's textareas (EDITOR.md §3.4):
// the same targets as Insert Link (`linkTargetTree`), fully expanded, 22 px rows.
import React, {useEffect, useMemo, useState} from "react";
import {useAtomValue} from "jotai";
import {File, FileText, Hash} from "lucide-react";
import {flattenIndex, linkTargetTree, parseQuery, type TreeNode} from "@mdtree/core";
import {GlobalAtoms} from "../react-context/global";
import {separatorAtom} from "../react-context/settings";
import {extractTerms} from "../react-context/state";
import {highlightText} from "../NodeRenderer";
import {linkQueryAt} from "./textarea-ops";

const MAX_ROWS = 50

export type LinkSuggestState = {
    open: boolean
    rows: TreeNode[]
    selected: number
    setSelected: (i: number) => void
    dismiss: () => void
    start: number
    query: string
}

/** Suggestion state for the `[[query` before `caret`; `active` is false while the textarea is unfocused. */
export function useLinkSuggest(text: string, caret: number, active: boolean): LinkSuggestState {
    const graph = useAtomValue(GlobalAtoms.graphAtom)
    const version = useAtomValue(GlobalAtoms.graphVersionAtom)
    const separator = useAtomValue(separatorAtom)
    const [dismissedStart, setDismissedStart] = useState<number | null>(null)
    const [selected, setSelected] = useState(0)

    const at = active ? linkQueryAt(text, caret) : null
    const start = at?.start ?? -1
    const query = at?.query ?? ""

    useEffect(() => setSelected(0), [query])
    useEffect(() => { if (start < 0) setDismissedStart(null) }, [start])

    const rows = useMemo(
        () => query.length < 3 ? [] : flattenIndex(linkTargetTree(graph, query, separator), Infinity).slice(0, MAX_ROWS),
        [graph, version, query, separator],
    )

    return {
        open: start >= 0 && start !== dismissedStart && (query.length < 3 || rows.length > 0),
        rows,
        selected: Math.min(selected, Math.max(0, rows.length - 1)),
        setSelected,
        dismiss: () => setDismissedStart(start),
        start,
        query,
    }
}

export function LinkSuggest({state, onAccept}: { state: LinkSuggestState; onAccept: (row: TreeNode) => void }) {
    const separator = useAtomValue(separatorAtom)
    const terms = useMemo(() => parseQuery(state.query, separator).flatMap(extractTerms), [state.query, separator])

    if (!state.open) return null
    if (state.query.length < 3) {
        return <div className="ts-link-suggest">
            <div className="ts-link-suggest-row is-muted">Type 3+ characters</div>
        </div>
    }

    return <div className="ts-link-suggest">
        {state.rows.map((row, i) => {
            const node = row.node
            const label = node.nodeType === "header" ? node.header : node.nodeType === "page" ? node.page : node.searchKey
            const icon = node.nodeType === "header"
                ? <Hash size={12}/>
                : node.nodeType === "page" && node.isReference
                    ? <File size={12} className="is-muted"/>
                    : <FileText size={12}/>
            return <div
                key={i}
                className={`ts-link-suggest-row ${i === state.selected ? "is-selected" : ""}`}
                style={{paddingLeft: `${row.indent * 12}px`}}
                ref={i === state.selected ? (el => el?.scrollIntoView({block: "nearest"})) : undefined}
                onMouseEnter={() => state.setSelected(i)}
                onMouseDown={ev => {
                    ev.preventDefault()
                    onAccept(row)
                }}
            >
                {icon}
                <span>{highlightText(label, terms)}</span>
            </div>
        })}
    </div>
}
