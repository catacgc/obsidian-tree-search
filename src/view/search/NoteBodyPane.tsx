// Patch view's content pane, docked above the footer while an append chain has a row chip: an editable buffer of the
// anchored note's text after its leading outline (noteBody). The buffers live in SearchViewMolecule (chainBodiesAtom);
// Save, Mod+Enter and Enter in the search input write them together with the chain's pending patches (commitChainAtom).
import React, {useEffect, useLayoutEffect, useRef} from "react";
import {useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {Notice, Platform, Scope} from "obsidian";
import {ExternalLink} from "lucide-react";
import {GlobalAtoms} from "../react-context/global";
import {SearchViewMolecule} from "../react-context/state";
import {EditorMolecule} from "../editor/EditorMolecule";
import {basenameOf} from "../editor/draft";
import {ANY_MODIFIERS, MarkdownField, type MarkdownFieldHandle} from "../editor/MarkdownField";
import {linkAt, wrapLink, wrapSelection} from "../editor/textarea-ops";
import {openFileByName} from "../../obsidian-utils";
import {dirtyBodyPaths} from "./chain";

const NO_FILES = "Files can't be pasted into the note content here — use Alt+Enter to open the editor"

const mod = (ev: KeyboardEvent) => Platform.isMacOS ? ev.metaKey : ev.ctrlKey

export const NoteBodyPane = () => {
    const {
        chainBodyPathAtom, chainBodiesAtom, loadChainBodyAtom, setChainBodyTextAtom, chainWriteAtom, focusSearchInputAtom, scopeName,
    } = useMolecule(SearchViewMolecule)
    const {commitChainAtom} = useMolecule(EditorMolecule)
    const app = useAtomValue(GlobalAtoms.appAtom)
    const version = useAtomValue(GlobalAtoms.graphVersionAtom)
    const currentModal = useAtomValue(GlobalAtoms.currentModalAtom)
    const path = useAtomValue(chainBodyPathAtom)
    const bodies = useAtomValue(chainBodiesAtom)
    const chainWrite = useAtomValue(chainWriteAtom)
    const load = useSetAtom(loadChainBodyAtom)
    const setText = useSetAtom(setChainBodyTextAtom)
    const commit = useSetAtom(commitChainAtom)
    const focusSearch = useSetAtom(focusSearchInputAtom)

    const rootRef = useRef<HTMLDivElement>(null)
    const fieldRef = useRef<MarkdownFieldHandle | null>(null)
    /** Selection a key's text edit asks for, applied once the field shows the new text. */
    const pending = useRef<{start: number; end: number} | null>(null)
    const keyRef = useRef<(ev: KeyboardEvent) => boolean>(() => false)

    useEffect(() => { if (path) void load(path) }, [path, version])

    keyRef.current = ev => {
        if (ev.isComposing || path === null) return false
        if (ev.key === "Enter" && (mod(ev) || ev.shiftKey) && !ev.altKey) {
            void commit()
            return true
        }
        const key = ev.key.toLowerCase()
        const h = fieldRef.current
        if (mod(ev) && !ev.altKey && !ev.shiftKey && (key === "b" || key === "i" || key === "k") && h) {
            const text = h.text()
            const {start, end} = h.selection()
            const mark = key === "b" ? "**" : "*"
            const edit = key === "k" ? wrapLink(text, start, end) : wrapSelection(text, start, end, mark, mark)
            setText(path, edit.text)
            pending.current = {start: edit.caret, end: edit.selectionEnd ?? edit.caret}
            return true
        }
        return false
    }

    useLayoutEffect(() => {
        const p = pending.current
        if (!p) return
        pending.current = null
        fieldRef.current?.setSelection(p.start, p.end)
    })

    // Escape and the field's keys are claimed through an Obsidian Scope while focus is inside the pane (like the inline
    // editor): Escape goes back to the search input instead of closing the modal, and Mod+B/I/K/Enter beat Obsidian's
    // hotkeys, which would act on the workspace's note.
    const scopeRef = useRef<Scope | null>(null)
    const pushScope = () => {
        if (scopeRef.current || !app) return
        const scope = new Scope(app.scope)
        scope.register([], "Escape", () => {
            focusSearch(n => n + 1)
            return false
        })
        // Unhandled keys (undefined) fall through to the field and Obsidian's hotkeys.
        scope.register(ANY_MODIFIERS, null, ev => keyRef.current(ev) ? false : undefined)
        app.keymap.pushScope(scope)
        scopeRef.current = scope
    }
    const popScope = () => {
        if (!scopeRef.current || !app) return
        app.keymap.popScope(scopeRef.current)
        scopeRef.current = null
    }
    useEffect(() => popScope, [])

    if (path === null || bodies[path] === undefined) return null
    const body = bodies[path]
    const dirty = body.text !== body.original
    const allDirty = dirtyBodyPaths(bodies)
    const others = allDirty.filter(p => p !== path)
    const canSave = allDirty.length > 0 || (chainWrite !== null && !("error" in chainWrite))

    const onPaste = (ev: ClipboardEvent): boolean => {
        if (!ev.clipboardData?.files.length) return false
        new Notice(NO_FILES)
        return true
    }

    const onLinkClick = (pos: number, isMod: boolean): boolean => {
        const name = linkAt(fieldRef.current?.text() ?? "", pos)
        if (!isMod || !name) return false
        void openFileByName(app, name)
        return true
    }

    /** Opens the note in Obsidian; the modal closes unless it would drop unsaved edits. */
    const openInObsidian = async () => {
        await openFileByName(app, path.replace(/\.md$/i, ""))
        if (scopeName.name === "modal" && allDirty.length === 0) currentModal?.close()
    }

    return <div className="ts-note-body" ref={rootRef} onFocus={pushScope}
                onBlur={ev => { if (!rootRef.current?.contains(ev.relatedTarget as Node | null)) popScope() }}>
        <div className="ts-note-body-header">
            <span className="ts-note-body-title">{basenameOf(path)}</span>
            {dirty && <span className="ts-note-body-dirty" aria-label="Unsaved changes">●</span>}
            {others.length > 0 && <span className="ts-note-body-others" title={others.map(basenameOf).join(", ")}>+{others.length} unsaved</span>}
            <button className="ts-note-body-save" disabled={!canSave} title={Platform.isMacOS ? "Save (⌘↵)" : "Save (Ctrl+Enter)"}
                    onClick={() => void commit()}>Save</button>
            <button className="clickable-icon ts-note-body-open" aria-label="Open in Obsidian" onClick={() => void openInObsidian()}>
                <ExternalLink size={14}/>
            </button>
        </div>
        <MarkdownField key={path} app={app} handleRef={fieldRef} className="ts-note-body-text" value={body.text}
                       readOnly={false} sourcePath={path}
                       onText={text => setText(path, text)} onCaret={() => {}} onEnter={() => false} onBackspace={() => false}
                       onKeyDown={ev => keyRef.current(ev)} onPaste={onPaste} onDropFiles={() => { new Notice(NO_FILES) }}
                       onLinkClick={onLinkClick} onFocus={() => {}}/>
    </div>
}
