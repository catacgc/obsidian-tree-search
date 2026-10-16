import React, {useEffect, useLayoutEffect, useRef} from "react";
import {TREE_ICON, TIMELINE_ICON} from "../icons";
import {useUrlOpener} from "./useUrlOpener";
import {useAtom, useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {Platform, Scope} from "obsidian";
import {GlobalAppMolecule, SearchViewMolecule} from "../react-context/state";
import {GlobalAtoms} from "../react-context/global";
import {separatorAtom} from "../react-context/settings";
import {applyDateSuggestion, INVALID_NAME_RE, isDateSuggestion, openLinkAt, reverseMarkdownParsing, spliceSuggestion, type Suggestion} from "@mdtree/core";
import {SearchAutocomplete} from "./SearchAutocomplete";
import {EditorMolecule} from "../editor/EditorMolecule";
import {ActionsMolecule} from "../react-context/actions";
import {canMoveUnderNewPage, reparentLabel} from "./chain";
import {rootLabel} from "./outline";
import {isFilterSuggestion} from "./search-filter";

export type SearchBarProps = {
    isQuickLink: boolean
}

/** Left edge (px, in the input's offset parent) of the character at `pos`: the input's text width before it, in its font. */
function caretLeft(input: HTMLInputElement, pos: number): number {
    const style = getComputedStyle(input)
    const ctx = document.createElement("canvas").getContext("2d")
    let width = 0
    if (ctx) {
        ctx.font = style.font
        width = ctx.measureText(input.value.slice(0, pos)).width
    }
    return input.offsetLeft + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft) + width - input.scrollLeft
}

export const SearchBar = ({ isQuickLink }: SearchBarProps) => {

    const { lastSearchAtom } = useMolecule(GlobalAppMolecule)
    const {
        searchQueryAtom,
        searchPlaceholderAtom, suggestionsAtom, suggestionIndexAtom, cursorPosAtom, dismissSuggestionsAtom,
        resetSuggestionsAtom, repositionSuggestionsAtom, focusSearchInputAtom,
        allowTimeline, timelineActiveAtom, toggleViewModeAtom, scopeName, allowEditing,
        chainAtom, cancelChainAtom, startReparentAtom,
        outlineAtom, openOutlineAtom, exitOutlineAtom, popCrumbAtom, openCrumbAtom, openFilterCrumbAtom, addFilterAtom,
        selectedNodeAtom, enterRowAtom, renderableTreeNodesAtom, toggleRowAtom,
        newLineSelectedAtom,
    } = useMolecule(SearchViewMolecule)
    const {reparentChainAtom, editAtom, patchAtom, saveOutlineAtom} = useMolecule(EditorMolecule)
    const {handleDefaultActionAtom} = useMolecule(ActionsMolecule)

    const separator = useAtomValue(separatorAtom)
    const [chain, setChain] = useAtom(chainAtom)
    const cancelChain = useSetAtom(cancelChainAtom)
    const startReparent = useSetAtom(startReparentAtom)
    const reparentChain = useSetAtom(reparentChainAtom)
    const outline = useAtomValue(outlineAtom)
    const openOutline = useSetAtom(openOutlineAtom)
    const exitOutline = useSetAtom(exitOutlineAtom)
    const popCrumb = useSetAtom(popCrumbAtom)
    const openCrumb = useSetAtom(openCrumbAtom)
    const openFilterCrumb = useSetAtom(openFilterCrumbAtom)
    const addFilter = useSetAtom(addFilterAtom)
    const edit = useSetAtom(editAtom)
    const patch = useSetAtom(patchAtom)
    const saveOutline = useSetAtom(saveOutlineAtom)
    const selectedNode = useAtomValue(selectedNodeAtom)
    const enterRow = useAtomValue(enterRowAtom)
    const rows = useAtomValue(renderableTreeNodesAtom)
    const toggleRow = useSetAtom(toggleRowAtom)
    const newLineSelected = useAtomValue(newLineSelectedAtom)
    const handleDefault = useSetAtom(handleDefaultActionAtom)

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

    // A link paste's caret/selection, applied once the controlled input shows the new query.
    const pendingSelection = useRef<{start: number; end: number} | null>(null)
    useLayoutEffect(() => {
        const sel = pendingSelection.current
        const el = inputRef.current
        if (!sel || !el) return
        pendingSelection.current = null
        try { el.setSelectionRange(sel.start, sel.end) } catch { /* type=search may reject it */ }
    }, [searchQuery.query])

    // Back from Quick Add or the editor: focus the input with the whole query selected. Deferred so it
    // runs after Obsidian restores focus on a closing modal.
    const [selectQuery, setSelectQuery] = useAtom(GlobalAtoms.selectQueryAtom)
    useEffect(() => {
        if (selectQuery?.view !== scopeName.name) return
        setSelectQuery(null)
        window.setTimeout(() => {
            inputRef.current?.focus()
            inputRef.current?.select()
        }, 0)
    }, [selectQuery])

    // Quick Add command: the outline editor on Today, with a new line open, in this view.
    const [quickAddRequest, setQuickAddRequest] = useAtom(GlobalAtoms.quickAddRequestAtom)
    useEffect(() => {
        if (quickAddRequest?.view !== scopeName.name) return
        setQuickAddRequest(null)
        openOutline({kind: "today", quickAdd: true})
    }, [quickAddRequest])

    // In the outline editor and the reparent chain (`<`), Escape leaves it (restoring the query) instead of closing the
    // modal; in the outline editor Alt+Enter edits the row Enter acts on and Mod+Enter saves (Obsidian's hotkeys would
    // take them before React sees them). While the autocomplete is open, Escape closes only it. Claimed through an
    // Obsidian Scope (like the action panel), pushed only while the input has focus and one of them is open.
    const app = useAtomValue(GlobalAtoms.appAtom)
    const scopeRef = useRef<Scope | null>(null)
    const escapeRef = useRef<() => void>(() => {})
    escapeRef.current = () => suggestions.length > 0 ? dismissSuggestions() : chain ? cancelChain() : exitOutline()
    const altEnterRef = useRef<() => boolean>(() => false)
    altEnterRef.current = () => {
        if (!outline) return false
        void edit()
        return true
    }
    const modEnterRef = useRef<() => boolean>(() => false)
    modEnterRef.current = () => {
        if (!outline) return false
        void saveOutline()
        return true
    }
    const pushScope = () => {
        if (scopeRef.current || !app) return
        const scope = new Scope(app.scope)
        scope.register([], "Escape", () => { escapeRef.current(); return false })
        // Unhandled (undefined) falls through to Obsidian's hotkeys.
        scope.register(["Alt"], "Enter", () => altEnterRef.current() ? false : undefined)
        scope.register(["Mod"], "Enter", () => modEnterRef.current() ? false : undefined)
        app.keymap.pushScope(scope)
        scopeRef.current = scope
    }
    const popScope = () => {
        if (!scopeRef.current || !app) return
        app.keymap.popScope(scopeRef.current)
        scopeRef.current = null
    }
    const claimKeys = chain !== null || outline !== null || suggestions.length > 0
    useEffect(() => {
        if (claimKeys && document.activeElement === inputRef.current) pushScope()
        else if (!claimKeys) popScope()
    }, [claimKeys])
    useEffect(() => popScope, [])

    const setSearch = (search: string) => {
        setSearchQuery({ query: search })
        saveLastSearch({ query: search })
    }

    const updateCursor = (ev: React.SyntheticEvent<HTMLInputElement>) => {
        setCursorPos(ev.currentTarget.selectionStart ?? ev.currentTarget.value.length)
    }

    const acceptSuggestion = (suggestion: Suggestion) => {
        if (isDateSuggestion(suggestion)) {
            const edit = applyDateSuggestion(searchQuery.query, suggestion)
            pendingSelection.current = {start: edit.caret, end: edit.caret}
            setSearch(edit.text)
            setCursorPos(edit.caret)
        } else {
            const spliced = spliceSuggestion(searchQuery.query, cursorPos, suggestion.insertText)
            setSearch(spliced.query)
            setCursorPos(spliced.cursorPos)
        }
        resetSuggestions()
    }

    /** Autocomplete keys; true when the key was handled. */
    const handleSuggestionKey = (ev: React.KeyboardEvent<HTMLInputElement>): boolean => {
        if (suggestions.length === 0) return false

        if (ev.key === "ArrowDown") {
            setSuggestionIndex((suggestionIndex + 1) % suggestions.length)
        } else if (ev.key === "ArrowUp") {
            setSuggestionIndex((suggestionIndex - 1 + suggestions.length) % suggestions.length)
        } else if (ev.key === "Enter" && !ev.altKey && !ev.shiftKey
            && (isDateSuggestion(suggestions[suggestionIndex]) || isFilterSuggestion(suggestions[suggestionIndex]))) {
            acceptSuggestion(suggestions[suggestionIndex])
        } else if (ev.key === "Tab") {
            acceptSuggestion(suggestions[suggestionIndex])
        } else if (ev.key === "Escape") {
            dismissSuggestions()
        } else {
            return false
        }
        ev.preventDefault(); ev.stopPropagation()
        return true
    }

    /** Outline editor and chain keys; true when the key was handled. `>` opens the outline editor on the selected row
     *  (patchAtom; in it: descends), `<` starts Move under. In the outline editor Enter runs the row's Enter (edit or
     *  explore: openRowAtom; an empty input: the first row's), and typed text with no row picked becomes a filter
     *  crumb; Backspace in an empty input drops the last crumb (in the reparent chain: leaves it). `>` and `<` need
     *  editor mode; Move under started from Alt+M or the action panel works in every view. */
    const handleOutlineKey = (ev: React.KeyboardEvent<HTMLInputElement>): boolean => {
        if (ev.nativeEvent.isComposing || ev.metaKey || ev.ctrlKey) return false
        const q = searchQuery.query
        const input = ev.currentTarget
        const selectedRow = selectedNode && !selectedNode.archiveRow ? selectedNode : null

        if (ev.key === ">" && allowEditing && !ev.altKey && separator !== ">" && chain === null) {
            patch()
        } else if (ev.key === "<" && allowEditing && !ev.altKey && separator !== "<" && selectedRow && outline === null) {
            startReparent()
        } else if (ev.key === "Backspace" && (chain || outline) && q === "" && input.selectionStart === 0 && input.selectionEnd === 0) {
            if (chain) cancelChain()
            else popCrumb()
        } else if (ev.key === "Enter" && chain?.mode === "reparent" && !ev.altKey && !ev.shiftKey) {
            const name = q.trim()
            if (enterRow && !enterRow.archiveRow) void reparentChain(enterRow.node)
            else if (rows.length === 0 && chain.children.some(c => canMoveUnderNewPage(c.node)) && name.length >= 3 && !INVALID_NAME_RE.test(name)) {
                if (chain.confirm === name) void reparentChain({nodeType: "newPage", name})
                else setChain({...chain, confirm: name})
            }
        } else if (ev.key === "Enter" && outline && !ev.altKey && !ev.shiftKey) {
            // A picked row or New line, or an empty input (the first row): the row's Enter (openRowAtom: edit or
            // explore); typed text with nothing picked becomes a filter crumb.
            if (selectedRow || newLineSelected || q.trim() === "") void handleDefault()
            else addFilter()
        } else {
            return false
        }
        ev.preventDefault(); ev.stopPropagation()
        return true
    }

    /** → with the caret at the end of the query (or an empty query): expands / collapses the selected row. */
    const handleExpandKey = (ev: React.KeyboardEvent<HTMLInputElement>): boolean => {
        if (ev.key !== "ArrowRight" || ev.altKey || ev.shiftKey || ev.metaKey || ev.ctrlKey) return false
        const {selectionStart, selectionEnd, value} = ev.currentTarget
        if (selectionStart !== value.length || selectionEnd !== value.length) return false
        if (!selectedNode || !toggleRow(selectedNode.index)) return false
        ev.preventDefault(); ev.stopPropagation()
        return true
    }

    /** Open `[[frag`: Enter or Tab on a note/heading row replaces it with the row's link, which then scopes the search to that tree. */
    const handleLinkKey = (ev: React.KeyboardEvent<HTMLInputElement>): boolean => {
        if (isQuickLink || chain?.mode === "reparent" || outline) return false
        if ((ev.key !== "Enter" && ev.key !== "Tab") || ev.shiftKey || ev.altKey || ev.metaKey || ev.ctrlKey || ev.nativeEvent.isComposing) return false
        const open = openLinkAt(searchQuery.query)
        if (!open || !selectedNode || selectedNode.archiveRow) return false
        const n = selectedNode.node
        if (n.nodeType !== "page" && n.nodeType !== "header") return false
        const q = searchQuery.query.slice(0, open.start) + reverseMarkdownParsing(n)
        setSearch(q)
        setCursorPos(q.length)
        resetSuggestions()
        ev.preventDefault(); ev.stopPropagation()
        return true
    }

    const handleKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
        if (handleSuggestionKey(ev)) return
        if (handleLinkKey(ev)) return
        if (handleExpandKey(ev)) return
        handleOutlineKey(ev)
    }

    // The outline editor's crumbs read `<query> › Row › is:task` (`search` for an empty query): a click on the first leaves it, on a path crumb makes it
    // the root, on a filter crumb drops the crumbs after it. The reparent chain shows its one chip instead.
    const crumbs = outline && [
        ...outline.path.map((root, i) => ({key: `p${i}`, label: rootLabel(root), filter: false, open: () => openCrumb(i)})),
        ...outline.filters.map((f, i) => ({key: `f${i}`, label: f, filter: true, open: () => openFilterCrumb(i)})),
    ]
    const chips = chain?.mode === "reparent"
        ? <span className="ts-chain-chip is-reparent">{reparentLabel(chain.children)} &lt;</span>
        : crumbs
        ? <span className="ts-outline-crumbs">
            <span role="button" title="Back to the search" className="ts-outline-crumb"
                  onMouseDown={ev => ev.preventDefault()} onClick={() => exitOutline()}>{outline.prevQuery.trim() || "search"}</span>
            {crumbs.flatMap(c => [
                <span key={c.key + "›"} className="ts-outline-crumb-sep">›</span>,
                <span key={c.key} role="button" title={c.label} className={"ts-outline-crumb" + (c.filter ? " is-filter" : "")}
                      onMouseDown={ev => ev.preventDefault()} onClick={c.open}>{c.label}</span>,
            ])}
        </span>
        : null

    const { linkRef, tryOpenUrl } = useUrlOpener()
    const dateAt = suggestions.length > 0 && isDateSuggestion(suggestions[0]) && inputRef.current
        ? {left: caretLeft(inputRef.current, suggestions[0].start)} : undefined

    return <>
        <a style={{ display: "none" }} target="_blank" ref={linkRef} href="#"></a>
    <div className="tw-reset sticky top-0 z-30">

        {/* On mobile the chips sit on their own row above the search field, wrapping, so the field keeps its width. */}
        {Platform.isMobile && chips && <div className="ts-search-chips-row">{chips}</div>}
        <div className="relative flex items-center flex-1 min-w-0">
            <div className="flex items-center justify-between w-full max-w-4xl min-w-0">
                {/* min-w-0: the chips' max-width doesn't bound their min-content, which would widen the view. */}
                <div className="relative flex-1 flex items-center min-w-0">
                    {!Platform.isMobile && chips}
                    <input
                        ref={inputRef}
                        enterKeyHint="search"
                        type="search"
                        spellCheck="false"
                        onChange={ev => { setSearch(ev.target.value); resetSuggestions(); updateCursor(ev) }}
                        onKeyDown={handleKeyDown}
                        onSelect={ev => { updateCursor(ev); repositionSuggestions() }}
                        onFocus={() => { if (claimKeys) pushScope() }}
                        onBlur={popScope}
                        value={searchQuery.query}
                        placeholder={searchPlaceholder}
                        className="flex-1 min-w-0 pl-5 ml-1 mb-2 mt-2 pr-8 py-3
                        rounded-lg border focus:border-obs-hover hover:border-obs-hover focus:ring-0
                        outline-none transition-all duration-150
                        "
                    />

                    <SearchAutocomplete
                        suggestions={suggestions}
                        highlightedIndex={suggestionIndex}
                        onHover={setSuggestionIndex}
                        onAccept={acceptSuggestion}
                        at={dateAt}
                    />

                    <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center">
                        <button
                            className="text-obs-base-40 focus:outline-none hover:text-obs-accent bg-transparent border-none p-1"
                            aria-label="Clear search"
                            onClick={() => { if (chain) cancelChain(); else setSearch("") }}
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
