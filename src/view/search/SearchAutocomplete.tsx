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

    // Styled as the ⌘K action panel, like the editor's [[ link list: shared `.ts-suggest` surface and item rows (ActionPanel.css).
    return (
        <div className="ts-suggest" role="listbox">
            {suggestions.map((s, i) => (
                <div
                    key={s.label}
                    role="option"
                    aria-selected={i === highlightedIndex}
                    className={`ts-action-panel-item ${i === highlightedIndex ? "is-selected" : ""}`}
                    onMouseEnter={() => onHover(i)}
                    onMouseDown={ev => { ev.preventDefault(); onAccept(s) }}
                >
                    <span className="ts-action-panel-label">{s.label}</span>
                </div>
            ))}
        </div>
    )
}
