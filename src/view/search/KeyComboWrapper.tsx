import React, {useEffect, useRef} from "react";
import {useAtomValue, useSetAtom} from "jotai";
import {Platform} from "obsidian";
import {useMolecule} from "bunshi/react";
import {SearchViewMolecule} from "../react-context/state";
import {swallowDeadKey} from "../editor/dead-key";
import {isAvailable, matchShortcut, SHORTCUTS} from "./shortcuts";
import {useShortcutHandlers} from "./shortcut-handlers";

const ACTIONS_ONLY = SHORTCUTS.filter(s => s.id === "actions")

/** A text field with selected text: ⌘X there is the native cut, not the drawer's. */
const hasTextSelection = (t: EventTarget) =>
    (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) && t.selectionStart !== t.selectionEnd

/** The inline editor, the outline editor's line editor and its content pane own their keys. */
const OWN_KEYS = ".ts-inline-editor, .ts-line-editor, .ts-note-body"

// Dispatches the search view's keyboard shortcuts (./shortcuts.ts) for keys that bubble up
// from the search input, the results list and the action panel's filter. While the view
// shows the inline editor, none of them fire: the editor owns every key; nor do keys typed in
// the outline editor's line editor or content pane.
export const KeyComboWrapper = ({children}: { children: React.ReactNode }) => {
    const {allowEditing, allowTimeline, closeActionPanelAtom, toggleActionPanelAtom, editorOpenAtom} = useMolecule(SearchViewMolecule)
    const closeActionPanel = useSetAtom(closeActionPanelAtom)
    const toggleActionPanel = useSetAtom(toggleActionPanelAtom)
    const handlers = useShortcutHandlers()
    const editorOpen = useAtomValue(editorOpenAtom)
    const available = SHORTCUTS.filter(s => isAvailable(s, {allowEditing, allowTimeline}))
    const rootRef = useRef<HTMLDivElement>(null)

    // ⌘K / Ctrl+K may be bound to an Obsidian command (hotkeys are handled before React sees the
    // key), so claim it in the window's capture phase while focus is in this view. The inline
    // editor keeps its own Mod+K (wrap as link).
    useEffect(() => {
        const onKey = (ev: KeyboardEvent) => {
            const target = ev.target as HTMLElement | null
            if (!target || !rootRef.current?.contains(target) || target.closest(OWN_KEYS)) return
            if (matchShortcut(ev, ACTIONS_ONLY, Platform.isMacOS) === null) return
            ev.preventDefault()
            ev.stopImmediatePropagation()
            toggleActionPanel()
        }
        window.addEventListener("keydown", onKey, true)
        return () => window.removeEventListener("keydown", onKey, true)
    }, [])

    const handleKeyDown = async (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (editorOpen || (event.target as Element).closest(OWN_KEYS)) return
        const hit = matchShortcut(event, available, Platform.isMacOS)
        if (!hit) return
        if (hit.shortcut.id === "cut" && hasTextSelection(event.target)) return
        event.preventDefault()
        if (event.altKey) swallowDeadKey(event)
        // Any action other than toggling the panel ends the panel's use.
        if (hit.shortcut.id !== "actions") closeActionPanel()
        await handlers[hit.shortcut.id](hit.index)
    }

    return <div
        ref={rootRef}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        className="ts-search-view outline-none focus:outline-none"
    >
        {children}
    </div>
}
