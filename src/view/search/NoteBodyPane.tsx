// The outline editor's content pane, docked above the footer: an editable buffer of paneRefAtom's note text after its
// leading outline (noteBody), or for a heading the text under it (headingBody). The buffers live in SearchViewMolecule
// (outlineBodiesAtom); Save and Mod+Enter write them together with the line editor (saveOutlineAtom). Pasted or
// dropped files become attachments named after the note (bodyAttachmentsAtom), renamed by alias on save.
import React, {useEffect, useLayoutEffect, useRef, useState} from "react";
import {useAtom, useAtomValue, useSetAtom, useStore} from "jotai";
import {useMolecule} from "bunshi/react";
import {Platform, Scope} from "obsidian";
import {ChevronDown, ChevronUp, ExternalLink, Maximize2, Minimize2, X} from "lucide-react";
import {GlobalAtoms} from "../react-context/global";
import {SearchViewMolecule} from "../react-context/state";
import {EditorMolecule} from "../editor/EditorMolecule";
import {ANY_MODIFIERS, MarkdownField, type MarkdownFieldHandle} from "../editor/MarkdownField";
import {insertAtCaret, linkAt, wrapLink, wrapSelection} from "../editor/textarea-ops";
import {createAttachments} from "../editor/paste-attachments";
import {basenameOf} from "../editor/draft";
import {trashSessionAttachments} from "../../editing/vault-edits";
import {openFileByName} from "../../obsidian-utils";
import {dirtyBodyKeys} from "./chain";

const mod = (ev: KeyboardEvent) => Platform.isMacOS ? ev.metaKey : ev.ctrlKey

export const NoteBodyPane = () => {
    const {
        paneRefAtom, outlineBodiesAtom, bodyAttachmentsAtom, paneAtom, loadBodyAtom, setBodyTextAtom,
        focusSearchInputAtom, scopeName, outlineAtom, outlineDirtyAtom, discardBodiesAtom,
    } = useMolecule(SearchViewMolecule)
    const {saveOutlineAtom} = useMolecule(EditorMolecule)
    const store = useStore()
    const app = useAtomValue(GlobalAtoms.appAtom)
    const version = useAtomValue(GlobalAtoms.graphVersionAtom)
    const currentModal = useAtomValue(GlobalAtoms.currentModalAtom)
    const ref = useAtomValue(paneRefAtom)
    const bodies = useAtomValue(outlineBodiesAtom)
    const canSave = useAtomValue(outlineDirtyAtom)
    const explore = useAtomValue(outlineAtom)?.mode === "explore"
    const discardBodies = useSetAtom(discardBodiesAtom)
    /** Focus is inside the pane: explore mode shows Save and Discard only then. */
    const [focused, setFocused] = useState(false)
    const [pane, setPane] = useAtom(paneAtom)
    const load = useSetAtom(loadBodyAtom)
    const setText = useSetAtom(setBodyTextAtom)
    const setAttachments = useSetAtom(bodyAttachmentsAtom)
    const save = useSetAtom(saveOutlineAtom)
    const focusSearch = useSetAtom(focusSearchInputAtom)

    const rootRef = useRef<HTMLDivElement>(null)
    const fieldRef = useRef<MarkdownFieldHandle | null>(null)
    /** Selection a key's text edit asks for, applied once the field shows the new text. */
    const pending = useRef<{start: number; end: number} | null>(null)
    const keyRef = useRef<(ev: KeyboardEvent) => boolean>(() => false)
    /** The buffer the field shows, for pastes that finish after it changed. */
    const shownKey = useRef<string | null>(null)
    shownKey.current = ref?.key ?? null
    const alive = useRef(true)
    useEffect(() => {
        alive.current = true
        return () => { alive.current = false }
    }, [])

    useEffect(() => { if (ref) void load(ref) }, [ref?.key, version])

    // Explore mode sizes the pane for each newly shown buffer, by its text on disk: collapsed when the note has no
    // content, else normal. Typing never resizes it, and the user's own size sticks until another buffer is shown.
    const sizedKey = useRef<string | null>(null)
    const loaded = ref !== null && bodies[ref.key] !== undefined
    useEffect(() => {
        if (!explore || !ref || !loaded || sizedKey.current === ref.key) return
        sizedKey.current = ref.key
        setPane(p => ({...p, size: bodies[ref.key].original.trim() === "" ? "collapsed" : "normal"}))
    }, [explore, ref?.key, loaded])

    keyRef.current = ev => {
        if (ev.isComposing || ref === null) return false
        if (ev.key === "Enter" && (mod(ev) || ev.shiftKey) && !ev.altKey) {
            void save()
            return true
        }
        const key = ev.key.toLowerCase()
        const h = fieldRef.current
        if (mod(ev) && !ev.altKey && !ev.shiftKey && (key === "b" || key === "i" || key === "k") && h) {
            const text = h.text()
            const {start, end} = h.selection()
            const mark = key === "b" ? "**" : "*"
            const edit = key === "k" ? wrapLink(text, start, end) : wrapSelection(text, start, end, mark, mark)
            setText(ref.key, edit.text)
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

    if (ref === null || bodies[ref.key] === undefined || pane.closedKey === ref.key) return null
    const body = bodies[ref.key]
    const dirty = body.text !== body.original
    const allDirty = dirtyBodyKeys(bodies)
    const others = allDirty.filter(k => k !== ref.key)
    const collapsed = pane.size === "collapsed"
    const expanded = pane.size === "expanded"

    /** Files become attachments named after the note, embedded at the caret. A buffer released while they were being
     *  written (the outline closed or changed root) trashes them. */
    const pasteFiles = async (files: File[]) => {
        const key = ref.key
        const h = fieldRef.current
        const caret = h ? h.selection().start : body.text.length
        const atts = await createAttachments(app, files, basenameOf(ref.path), ref.path, store.get(bodyAttachmentsAtom))
        if (atts.length === 0) return
        const cur = store.get(outlineBodiesAtom)[key]
        if (!alive.current || cur === undefined) {
            await trashSessionAttachments(app, atts)
            return
        }
        setAttachments(prev => [...prev, ...atts])
        const shown = shownKey.current === key ? fieldRef.current : null
        const text = shown ? shown.text() : cur.text
        const edit = insertAtCaret(text, Math.min(caret, text.length), atts.map(a => `![[${a.name}]]`).join("\n"))
        setText(key, edit.text)
        if (shown) pending.current = {start: edit.caret, end: edit.caret}
    }

    /** Files are taken as attachments; text falls through to Obsidian's own paste. */
    const onPaste = (ev: ClipboardEvent): boolean => {
        const files = Array.from(ev.clipboardData?.files ?? [])
        if (files.length === 0) return false
        void pasteFiles(files)
        return true
    }

    const onLinkClick = (pos: number, isMod: boolean): boolean => {
        const name = linkAt(fieldRef.current?.text() ?? "", pos)
        if (!isMod || !name) return false
        void openFileByName(app, name)
        return true
    }

    /** Opens the note (at its heading) in Obsidian; the modal closes unless it would drop unsaved edits. */
    const openInObsidian = async () => {
        await openFileByName(app, ref.path.replace(/\.md$/i, "") + (ref.heading === null ? "" : `#${ref.heading}`))
        if (scopeName.name === "modal" && !canSave) currentModal?.close()
    }

    const className = "ts-note-body" + (expanded ? " is-expanded" : "") + (collapsed ? " is-collapsed" : "")
    return <div className={className} ref={rootRef} tabIndex={-1}
                onFocus={() => { pushScope(); setFocused(true) }}
                onKeyDown={ev => ev.stopPropagation()}
                onBlur={ev => {
                    if (rootRef.current?.contains(ev.relatedTarget as Node | null)) return
                    popScope()
                    setFocused(false)
                }}>
        <div className="ts-note-body-header">
            <span className="ts-note-body-title" title={ref.path}>{ref.label}</span>
            {dirty && <span className="ts-note-body-dirty" aria-label="Unsaved changes">●</span>}
            {others.length > 0 && <span className="ts-note-body-others" title={others.map(k => bodies[k].label).join(", ")}>+{others.length} unsaved</span>}
            <div className="ts-note-body-actions">
                {explore && focused && <button className="ts-note-body-discard" disabled={allDirty.length === 0}
                        title="Discard unsaved changes in the pane" onClick={() => discardBodies()}>Discard</button>}
                {(!explore || focused) && <button className="ts-note-body-save" disabled={!canSave}
                        title={Platform.isMacOS ? "Save (⌘↵)" : "Save (Ctrl+Enter)"} onClick={() => void save()}>Save</button>}
                <button className="clickable-icon" aria-label="Open in Obsidian" onClick={() => void openInObsidian()}>
                    <ExternalLink size={14}/>
                </button>
                <button className="clickable-icon" aria-label={expanded ? "Restore size" : "Expand"}
                        onClick={() => setPane({...pane, size: expanded ? "normal" : "expanded"})}>
                    {expanded ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}
                </button>
                <button className="clickable-icon" aria-label={collapsed ? "Show content" : "Collapse"}
                        onClick={() => setPane({...pane, size: collapsed ? "normal" : "collapsed"})}>
                    {collapsed ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                </button>
            </div>
            <button className="clickable-icon" aria-label="Close" onClick={() => setPane({...pane, closedKey: ref.key})}>
                <X size={14}/>
            </button>
        </div>
        {!collapsed && <MarkdownField key={ref.key} app={app} handleRef={fieldRef} className="ts-note-body-text" value={body.text}
                       readOnly={false} sourcePath={ref.path}
                       onText={text => setText(ref.key, text)} onCaret={() => {}} onEnter={() => false} onBackspace={() => false}
                       onKeyDown={ev => keyRef.current(ev)} onPaste={onPaste} onDropFiles={files => void pasteFiles(files)}
                       onLinkClick={onLinkClick} onFocus={() => {}}/>}
    </div>
}
