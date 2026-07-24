import React from "react";
import type { Suggestion } from "@mdtree/core";

export type SearchAutocompleteProps = {
    suggestions: Suggestion[]
    highlightedIndex: number
    onHover: (index: number) => void
    onAccept: (suggestion: Suggestion) => void
}

export const SearchAutocomplete = ({ suggestions, highlightedIndex, onHover, onAccept }: SearchAutocompleteProps) => {
    if (suggestions.length === 0) return null

    return (
        <div className="tw-reset absolute left-0 right-1 top-full mt-1 z-20 rounded-lg border bg-obs-base-0 shadow-lg overflow-hidden">
            {suggestions.map((s, i) => (
                <div
                    key={s.label}
                    className={`px-3 py-2 cursor-pointer text-sm font-mono ${i === highlightedIndex ? "bg-obs-hover" : ""}`}
                    onMouseEnter={() => onHover(i)}
                    onMouseDown={ev => { ev.preventDefault(); onAccept(s) }}
                >
                    {s.label}
                </div>
            ))}
        </div>
    )
}
