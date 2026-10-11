import React from "react";
import type { Suggestion } from "@mdtree/core";

export type SearchAutocompleteProps = {
    suggestions: Suggestion[]
    highlightedIndex: number
    onHover: (index: number) => void
    onAccept: (suggestion: Suggestion) => void
    /** Open at this point (px, in the positioned parent), e.g. under an `@word`; omitted: full width under the input. */
    at?: {left: number; top?: number}
}

export const SearchAutocomplete = ({ suggestions, highlightedIndex, onHover, onAccept, at }: SearchAutocompleteProps) => {
    if (suggestions.length === 0) return null

    // Styled as the ⌘K action panel, like the editor's [[ link list: shared `.ts-suggest` surface and item rows (ActionPanel.css).
    return (
        <div className={`ts-suggest${at ? " is-at-caret" : ""}`} style={at} role="listbox">
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
                    {s.detail && <span className="ts-suggest-detail">{s.detail}</span>}
                </div>
            ))}
        </div>
    )
}
