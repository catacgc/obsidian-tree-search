// The inline editor's `@` scheduled-date popup state (dateSuggestAt on the focused outline field).
import {useEffect, useState} from "react";
import {dateSuggestAt, type DateSuggestion} from "@mdtree/core";

export type DateSuggestState = {
    /** Empty while closed. */
    items: DateSuggestion[]
    index: number
    setIndex(index: number): void
    move(delta: 1 | -1): void
    /** Hides the popup until this `@word` is closed. */
    dismiss(): void
}

export function useDateSuggest(text: string, caret: number, active: boolean, linePrefix: string): DateSuggestState {
    const [dismissedStart, setDismissedStart] = useState<number | null>(null)
    const [index, setIndex] = useState(0)
    const all = active ? dateSuggestAt(text, caret, new Date(), linePrefix) : []
    const start = all[0]?.start ?? -1
    const items = start === dismissedStart ? [] : all
    const labels = items.map(s => s.label).join()

    useEffect(() => { if (start < 0) setDismissedStart(null) }, [start])
    useEffect(() => setIndex(0), [labels, start])

    const i = Math.min(index, Math.max(0, items.length - 1))
    return {
        items,
        index: i,
        setIndex,
        move: delta => setIndex((i + delta + items.length) % items.length),
        dismiss: () => setDismissedStart(start),
    }
}
