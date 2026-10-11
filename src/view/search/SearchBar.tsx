import React, {useEffect, useLayoutEffect, useRef} from "react";
import {TREE_ICON, TIMELINE_ICON} from "../icons";
import {useUrlOpener} from "./useUrlOpener";
import {useAtom, useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {Scope} from "obsidian";
import {GlobalAppMolecule, SearchViewMolecule} from "../react-context/state";
import {GlobalAtoms} from "../react-context/global";
import {separatorAtom} from "../react-context/settings";
import {applyDateSuggestion, INVALID_NAME_RE, isDateSuggestion, openLinkAt, reverseMarkdownParsing, spliceSuggestion, type Suggestion} from "@mdtree/core";
import {SearchAutocomplete} from "./SearchAutocomplete";
import {EditorMolecule} from "../editor/EditorMolecule";
import {linkPasteEdit} from "../editor/clipboard";
import {canMoveUnderNewPage} from "./chain";

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
        chainAtom, chainWriteAtom, popChainAtom, cancelChainAtom, startReparentAtom, clearChainAtom,
        selectedNodeAtom, renderableTreeNodesAtom, toggleRowAtom,
    } = useMolecule(SearchViewMolecule)
    const {pushChainAtom, commitChainAtom, openChainEditorAtom, pasteIntoChainAtom, reparentChainAtom} = useMolecule(EditorMolecule)

    const separator = useAtomValue(separatorAtom)
    const [chain, setChain] = useAtom(chainAtom)
    const chainWrite = useAtomValue(chainWriteAtom)
    const pushChain = useSetAtom(pushChainAtom)
    const commitChain = useSetAtom(commitChainAtom)
    const openChainEditor = useSetAtom(openChainEditorAtom)
    const pasteIntoChain = useSetAtom(pasteIntoChainAtom)
    const cancelChain = useSetAtom(cancelChainAtom)
    const popChain = useSetAtom(popChainAtom)
    const startReparent = useSetAtom(startReparentAtom)
    const clearChain = useSetAtom(clearChainAtom)
    const reparentChain = useSetAtom(reparentChainAtom)
    const selectedNode = useAtomValue(selectedNodeAtom)
    const rows = useAtomValue(renderableTreeNodesAtom)
    const toggleRow = useSetAtom(toggleRowAtom)

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

    // During a chain (`>` append, `<` Move to), Escape leaves it (clears the chips, restores the query) instead of
    // closing the modal, and Alt+Enter opens an append chain in the editor (Obsidian's hotkeys would take it before
    // React sees it). Claimed through an Obsidian Scope (like the action panel), pushed only while the input has focus.
    const app = useAtomValue(GlobalAtoms.appAtom)
    const scopeRef = useRef<Scope | null>(null)
    const escapeRef = useRef<() => void>(() => {})
    escapeRef.current = () => suggestions.length > 0 ? dismissSuggestions() : cancelChain()
    const altEnterRef = useRef<() => boolean>(() => false)
    altEnterRef.current = () => {
        if (chain?.mode !== "append") return false
        void openChainEditor(null)
        return true
    }
    const pushScope = () => {
        if (scopeRef.current || !app) return
        const scope = new Scope(app.scope)
        scope.register([], "Escape", () => { escapeRef.current(); return false })
        // Unhandled (undefined) falls through to Obsidian's hotkeys.
        scope.register(["Alt"], "Enter", () => altEnterRef.current() ? false : undefined)
        app.keymap.pushScope(scope)
        scopeRef.current = scope
    }
    const popScope = () => {
        if (!scopeRef.current || !app) return
        app.keymap.popScope(scopeRef.current)
        scopeRef.current = null
    }
    useEffect(() => {
        if (chain && document.activeElement === inputRef.current) pushScope()
        else if (!chain) popScope()
    }, [chain])
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
        } else if (ev.key === "Enter" && !ev.altKey && !ev.shiftKey && isDateSuggestion(suggestions[suggestionIndex])) {
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

    /** Chain keys; true when the key was handled. `>` pushes a chip onto the append chain (pushChainAtom), Enter writes
     *  it, Alt+Enter opens the Outline editor on it; `<` starts Move to. `>` and `<` need editor mode; Move to started
     *  from Alt+M or the action panel works in every view. */
    const handleChainKey = (ev: React.KeyboardEvent<HTMLInputElement>): boolean => {
        if (ev.nativeEvent.isComposing || ev.metaKey || ev.ctrlKey) return false
        const q = searchQuery.query
        const input = ev.currentTarget
        const selectedRow = selectedNode && !selectedNode.archiveRow ? selectedNode : null

        if (ev.key === ">" && allowEditing && !ev.altKey && separator !== ">" && chain?.mode !== "reparent") {
            void pushChain()
        } else if (ev.key === "<" && allowEditing && !ev.altKey && separator !== "<" && selectedRow && chain?.mode !== "append") {
            startReparent()
        } else if (ev.key === "Backspace" && chain && q === "" && input.selectionStart === 0 && input.selectionEnd === 0) {
            popChain()
        } else if (ev.key === "Enter" && chain?.mode === "reparent" && !ev.altKey && !ev.shiftKey) {
            const name = q.trim()
            if (selectedRow) void reparentChain(selectedRow.node)
            else if (rows.length === 0 && canMoveUnderNewPage(chain.child.node) && name.length >= 3 && !INVALID_NAME_RE.test(name)) {
                if (chain.confirm === name) void reparentChain({nodeType: "newPage", name})
                else setChain({...chain, confirm: name})
            }
        } else if (ev.key === "Enter" && chain?.mode === "append" && !ev.altKey && !ev.shiftKey) {
            // No pending write: Enter opens the selected row (KeyComboWrapper).
            if (chainWrite === null) return false
            void commitChain()
        } else if (ev.key === "Enter" && chain?.mode === "append" && ev.altKey) {
            void openChainEditor(null)
        } else {
            return false
        }
        ev.preventDefault(); ev.stopPropagation()
        return true
    }

    /** Pastes in an append chain: a single URL becomes a markdown link as in the editor (EDITOR.md §3.8: over the
     *  selection, else `[title](url)` with the title selected, else `[](url)` with the caret inside); a multi-line or
     *  file paste continues in the editor (pasteIntoChainAtom). */
    const onPaste = (ev: React.ClipboardEvent<HTMLInputElement>) => {
        if (chain?.mode !== "append") return
        const files = Array.from(ev.clipboardData.files)
        const plain = ev.clipboardData.getData("text/plain")
        const html = ev.clipboardData.getData("text/html")
        const input = ev.currentTarget
        const start = input.selectionStart ?? input.value.length
        const link = files.length === 0 ? linkPasteEdit(input.value, start, input.selectionEnd ?? start, {plain, html}) : null
        if (link) {
            ev.preventDefault()
            pendingSelection.current = {start: link.caret, end: link.selectionEnd ?? link.caret}
            setSearch(link.text)
            setCursorPos(link.caret)
            resetSuggestions()
            return
        }
        if (files.length === 0 && !plain.includes("\n")) return
        ev.preventDefault()
        void pasteIntoChain({files, plain, html})
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
        if (isQuickLink || chain?.mode === "reparent") return false
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
        handleChainKey(ev)
    }

    const chips = chain?.mode === "reparent"
        ? [<span key="reparent" className="ts-chain-chip is-reparent">{chain.child.label} &lt;</span>]
        : chain?.mode === "append"
        ? chain.steps.map((step, i) =>
            <span key={i} className={"ts-chain-chip" + (step.kind === "entry" ? " is-entry" : "")}>{step.label} &gt;</span>)
        : []

    const { linkRef, tryOpenUrl } = useUrlOpener()
    const dateAt = suggestions.length > 0 && isDateSuggestion(suggestions[0]) && inputRef.current
        ? {left: caretLeft(inputRef.current, suggestions[0].start)} : undefined

    return <>
        <a style={{ display: "none" }} target="_blank" ref={linkRef} href="#"></a>
    <div className="tw-reset sticky top-0 z-30">

        <div className="relative flex items-center flex-1">
            <div className="flex items-center justify-between w-full max-w-4xl">
                <div className="relative flex-1 flex items-center">
                    {chips}
                    <input
                        ref={inputRef}
                        enterKeyHint="search"
                        type="search"
                        spellCheck="false"
                        onChange={ev => { setSearch(ev.target.value); resetSuggestions(); updateCursor(ev) }}
                        onKeyDown={handleKeyDown}
                        onPaste={onPaste}
                        onSelect={ev => { updateCursor(ev); repositionSuggestions() }}
                        onFocus={() => { if (chain) pushScope() }}
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
                            onClick={() => { clearChain(); setSearch("") }}
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
