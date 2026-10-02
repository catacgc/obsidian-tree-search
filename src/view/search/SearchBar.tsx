import React, {useEffect, useRef} from "react";
import {TREE_ICON, TIMELINE_ICON} from "../icons";
import {useUrlOpener} from "./useUrlOpener";
import {useAtom, useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {GlobalAppMolecule, SearchViewMolecule} from "../react-context/state";
import {spliceSuggestion, type Suggestion} from "@mdtree/core";
import {SearchAutocomplete} from "./SearchAutocomplete";

export type SearchBarProps = {
    isQuickLink: boolean
}

export const SearchBar = ({ isQuickLink }: SearchBarProps) => {

    const { lastSearchAtom } = useMolecule(GlobalAppMolecule)
    const {
        searchQueryAtom,
        searchPlaceholderAtom, suggestionsAtom, suggestionIndexAtom, cursorPosAtom, dismissSuggestionsAtom,
        resetSuggestionsAtom, repositionSuggestionsAtom, focusSearchInputAtom,
        allowTimeline, timelineActiveAtom, toggleViewModeAtom,
    } = useMolecule(SearchViewMolecule)

    const timelineActive = useAtomValue(timelineActiveAtom)
    const toggleViewMode = useSetAtom(toggleViewModeAtom)

    const searchPlaceholder = useAtomValue(searchPlaceholderAtom)

    const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom)
    const saveLastSearch = useSetAtom(lastSearchAtom)

    const suggestions = useAtomValue(suggestionsAtom)
    const [suggestionIndex, setSuggestionIndex] = useAtom(suggestionIndexAtom)
    const [cursorPos, setCursorPos] = useAtom(cursorPosAtom)
    const dismissSuggestions = useSetAtom(dismissSuggestionsAtom)
    const resetSuggestions = useSetAtom(resetSuggestionsAtom)
    const repositionSuggestions = useSetAtom(repositionSuggestionsAtom)

    const inputRef = useRef<HTMLInputElement>(null)
    const focusSignal = useAtomValue(focusSearchInputAtom)
    useEffect(() => {
        if (focusSignal === 0) return
        const el = inputRef.current
        if (!el) return
        el.focus()
        // type="search" inputs reject setSelectionRange in some engines — best effort.
        try { const n = el.value.length; el.setSelectionRange(n, n) } catch { /* ignore */ }
    }, [focusSignal])

    const setSearch = (search: string) => {
        setSearchQuery({ query: search })
        saveLastSearch({ query: search })
    }

    const updateCursor = (ev: React.SyntheticEvent<HTMLInputElement>) => {
        setCursorPos(ev.currentTarget.selectionStart ?? ev.currentTarget.value.length)
    }

    const acceptSuggestion = (suggestion: Suggestion) => {
        const spliced = spliceSuggestion(searchQuery.query, cursorPos, suggestion.insertText)
        setSearch(spliced.query)
        setCursorPos(spliced.cursorPos)
        resetSuggestions()
    }

    const handleKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
        if (suggestions.length === 0) return

        if (ev.key === "ArrowDown") {
            ev.preventDefault(); ev.stopPropagation()
            setSuggestionIndex((suggestionIndex + 1) % suggestions.length)
        } else if (ev.key === "ArrowUp") {
            ev.preventDefault(); ev.stopPropagation()
            setSuggestionIndex((suggestionIndex - 1 + suggestions.length) % suggestions.length)
        } else if (ev.key === "Tab") {
            ev.preventDefault(); ev.stopPropagation()
            acceptSuggestion(suggestions[suggestionIndex])
        } else if (ev.key === "Escape") {
            ev.preventDefault(); ev.stopPropagation()
            dismissSuggestions()
        }
    }

    const { linkRef, tryOpenUrl } = useUrlOpener()

    return <>
        <a style={{ display: "none" }} target="_blank" ref={linkRef} href="#"></a>
    <div className="tw-reset sticky top-0 z-30">

        <div className="relative flex items-center flex-1">
            <div className="flex items-center justify-between w-full max-w-4xl">
                <div className="relative flex-1">
                    <input
                        ref={inputRef}
                        enterKeyHint="search"
                        type="search"
                        spellCheck="false"
                        onChange={ev => { setSearch(ev.target.value); resetSuggestions(); updateCursor(ev) }}
                        onKeyDown={handleKeyDown}
                        onSelect={ev => { updateCursor(ev); repositionSuggestions() }}
                        value={searchQuery.query}
                        placeholder={searchPlaceholder}
                        className="w-full pl-5 ml-1 mb-2 mt-2 pr-8 py-3
                        rounded-lg border focus:border-obs-hover hover:border-obs-hover focus:ring-0
                        outline-none transition-all duration-150
                        bg-obs-base-0
                        "
                    />

                    <SearchAutocomplete
                        suggestions={suggestions}
                        highlightedIndex={suggestionIndex}
                        onHover={setSuggestionIndex}
                        onAccept={acceptSuggestion}
                    />

                    <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center">
                        <button
                            className="text-obs-base-40 focus:outline-none hover:text-obs-accent bg-transparent border-none p-1"
                            aria-label="Clear search"
                            onClick={() => setSearch("")}
                        >
                            ×
                        </button>
                    </div>
                </div>

                {allowTimeline && <div className="ml-2 flex items-center">
                    <button className="bg-transparent border-none p-1 text-obs-base-40 hover:text-obs-accent focus:outline-none clickable-icon" aria-label={timelineActive ? "Show tree" : "Show timeline"} onClick={toggleViewMode}>
                        {timelineActive ? <TREE_ICON /> : <TIMELINE_ICON />}
                    </button>
                </div>}
            </div>

        </div>

    </div>
    </>
}
