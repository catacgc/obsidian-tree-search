// A text field backed by Obsidian's own markdown editor (CodeMirror 6, live preview), so rich
// pastes convert to markdown and editing behaves like a note. The editor never becomes the
// workspace's active editor: Obsidian's editor commands, hotkeys and `[[` suggest don't act on
// it, and the owner handles keys, pastes, drops and link clicks first through capture listeners
// on the host (they run before CodeMirror's and Obsidian's handlers on `.cm-content`).
import React, {useEffect, useLayoutEffect, useRef} from "react";
import {Notice, Platform, type App} from "obsidian";
import {ChangeSet, Compartment, EditorState, Prec, type Extension} from "@codemirror/state";
import {EditorView, keymap, type ViewUpdate} from "@codemirror/view";
import {editorAppProxy, embeddedEditorClass, type EmbeddedEditor, type EmbeddedEditorClass} from "./obsidian-editor";
import {changedRange} from "./textarea-ops";

export type MarkdownFieldHandle = {
    text(): string
    selection(): { start: number; end: number }
    setSelection(start: number, end?: number): void
    focus(): void
    /** Obsidian's list-aware indent / outdent of the selected lines (what Tab / Shift+Tab do in a note). */
    indent(dir: 1 | -1): void
    /** Viewport coordinates of the character at `pos` (CodeMirror coordsAtPos), null while not drawn. */
    coordsAt(pos: number): { left: number; bottom: number } | null
}

type Props = {
    app: App
    handleRef: React.MutableRefObject<MarkdownFieldHandle | null>
    className: string
    value: string
    readOnly: boolean
    /** Note the field's links and embeds resolve against. */
    sourcePath: string
    /** The user changed the text (typing, deleting, undo, native paste); `caret` is the new caret offset. */
    onText(text: string, caret: number): void
    /** The caret moved inside the field. */
    onCaret(caret: number): void
    /** Enter that reached CodeMirror's keymap (e.g. from an Android keyboard); true = handled. */
    onEnter(): boolean
    /** Backspace that reached CodeMirror's keymap (e.g. from an Android keyboard, which sends no keydown); true = handled. */
    onBackspace(): boolean
    /** Insertions that keep the doc valid, given the text a doc change produced (offsets in it). They are applied in the
     *  same transaction as every change (typing, deleting, undo, paste, owner updates), so one undo step reverts both;
     *  a caret at an insertion point moves past it. */
    repair?(text: string): { from: number; insert: string }[]
    /** True = handled; the field then stops the key before CodeMirror sees it. */
    onKeyDown(ev: KeyboardEvent): boolean
    /** True = handled; otherwise Obsidian's own paste runs. */
    onPaste(ev: ClipboardEvent): boolean
    onDropFiles(files: File[]): void
    /** Click on a rendered `[[link]]` starting at doc offset `pos`; true = handled. */
    onLinkClick(pos: number, mod: boolean): boolean
    onFocus(): void
}

const LINK_SELECTOR = ".cm-hmd-internal-link"

const linkTarget = (ev: MouseEvent): Element | null =>
    ev.button === 0 && ev.target instanceof Element ? ev.target.closest(LINK_SELECTOR) : null

export function MarkdownField(props: Props) {
    const latest = useRef(props)
    latest.current = props
    const hostRef = useRef<HTMLDivElement>(null)
    const edRef = useRef<EmbeddedEditor | null>(null)
    const editable = useRef(new Compartment())
    // Selection and focus of an editor torn down while the component stays mounted (StrictMode's
    // effect re-run), handed to its replacement so a caret the owner just placed survives.
    const carry = useRef<{ anchor: number; head: number; focused: boolean } | null>(null)

    // A layout effect so the handle exists before the owner's layout effects place a caret.
    useLayoutEffect(() => {
        const host = hostRef.current
        if (!host) return
        const {app, handleRef} = latest.current
        let Base: EmbeddedEditorClass
        try {
            Base = embeddedEditorClass(app)
        } catch (err) {
            new Notice(err instanceof Error ? err.message : String(err))
            return
        }

        // Defined here: `buildLocalExtensions` runs inside the base constructor, before subclass
        // fields exist, so its extensions come from this closure.
        class Field extends Base {
            updateBottomPadding() {}

            buildLocalExtensions(): Extension[] {
                return [
                    ...super.buildLocalExtensions(),
                    editable.current.of(EditorView.editable.of(!latest.current.readOnly)),
                    Prec.highest(keymap.of([
                        {key: "Enter", run: () => latest.current.onEnter()},
                        {key: "Backspace", run: () => latest.current.onBackspace()},
                    ])),
                    EditorState.transactionFilter.of(tr => {
                        const repairs = tr.docChanged ? latest.current.repair?.(tr.newDoc.toString()) : undefined
                        if (!repairs?.length) return tr
                        const changes = ChangeSet.of(repairs, tr.newDoc.length)
                        return [tr, {changes, selection: tr.newSelection.map(changes, 1), sequential: true}]
                    }),
                ]
            }

            onUpdate(u: ViewUpdate, changed: boolean) {
                super.onUpdate(u, changed)
                if (!u.docChanged && !u.selectionSet) return
                const head = u.state.selection.main.head
                const doc = u.docChanged ? u.state.doc.toString() : null
                if (doc !== null && doc !== latest.current.value) latest.current.onText(doc, head)
                else if (u.selectionSet) latest.current.onCaret(head)
            }
        }

        // The owner a note's editor expects (Kanban's `getMarkdownController`).
        const controller = {
            app,
            showSearch() {},
            toggleMode() {},
            onMarkdownScroll() {},
            getMode: () => "source",
            scroll: 0,
            editMode: null as EmbeddedEditor | null,
            get editor() { return controller.editMode?.editor },
            get file() { return app.vault.getFileByPath(latest.current.sourcePath) },
            get path() { return latest.current.sourcePath },
        }
        const ed = new Field(editorAppProxy(app), host, controller)
        controller.editMode = ed
        ed.load()
        ed.set(latest.current.value, true)
        edRef.current = ed
        const cm = ed.cm
        const clamp = (n: number) => Math.max(0, Math.min(n, cm.state.doc.length))
        const carried = carry.current
        carry.current = null
        if (carried) {
            cm.dispatch({selection: {anchor: clamp(carried.anchor), head: clamp(carried.head)}})
            if (carried.focused) cm.focus()
        }

        handleRef.current = {
            text: () => cm.state.doc.toString(),
            selection: () => ({start: cm.state.selection.main.from, end: cm.state.selection.main.to}),
            setSelection: (start, end = start) =>
                cm.dispatch({selection: {anchor: clamp(start), head: clamp(end)}, scrollIntoView: true}),
            focus: () => cm.focus(),
            indent: dir => ed.editor.exec(dir > 0 ? "indentMore" : "indentLess"),
            coordsAt: pos => cm.coordsAtPos(clamp(pos)),
        }

        const stop = (ev: Event) => {
            ev.preventDefault()
            ev.stopPropagation()
        }
        const onKeyDownCapture = (ev: KeyboardEvent) => { if (latest.current.onKeyDown(ev)) stop(ev) }
        // Keeps the search view's shortcuts out; Escape still reaches the owner's Obsidian Scope.
        const onKeyDownBubble = (ev: KeyboardEvent) => { if (ev.key !== "Escape") ev.stopPropagation() }
        const onPasteCapture = (ev: ClipboardEvent) => { if (latest.current.onPaste(ev)) stop(ev) }
        // Files go through the owner so they are tracked as session attachments.
        const onDropCapture = (ev: DragEvent) => {
            const files = ev.dataTransfer?.files
            if (!files?.length) return
            stop(ev)
            latest.current.onDropFiles(Array.from(files))
        }
        // Obsidian must never open a link clicked in the field.
        const onMouseDownCapture = (ev: MouseEvent) => {
            const link = linkTarget(ev)
            if (!link) return
            stop(ev)
            const pos = cm.posAtDOM(link, 0)
            if (latest.current.onLinkClick(pos, Platform.isMacOS ? ev.metaKey : ev.ctrlKey)) return
            cm.focus()
            cm.dispatch({selection: {anchor: cm.posAtCoords({x: ev.clientX, y: ev.clientY}) ?? pos}})
        }
        const onClickCapture = (ev: MouseEvent) => { if (linkTarget(ev)) stop(ev) }
        const onFocusIn = () => latest.current.onFocus()

        host.addEventListener("keydown", onKeyDownCapture, true)
        host.addEventListener("keydown", onKeyDownBubble)
        host.addEventListener("paste", onPasteCapture, true)
        host.addEventListener("drop", onDropCapture, true)
        host.addEventListener("mousedown", onMouseDownCapture, true)
        host.addEventListener("click", onClickCapture, true)
        host.addEventListener("focusin", onFocusIn)
        return () => {
            host.removeEventListener("keydown", onKeyDownCapture, true)
            host.removeEventListener("keydown", onKeyDownBubble)
            host.removeEventListener("paste", onPasteCapture, true)
            host.removeEventListener("drop", onDropCapture, true)
            host.removeEventListener("mousedown", onMouseDownCapture, true)
            host.removeEventListener("click", onClickCapture, true)
            host.removeEventListener("focusin", onFocusIn)
            const sel = cm.state.selection.main
            carry.current = {anchor: sel.anchor, head: sel.head, focused: cm.hasFocus}
            ed.unload()
            host.replaceChildren()
            edRef.current = null
            handleRef.current = null
        }
    }, [])

    // Model → editor as one undoable change, only when they differ (typing already updated the doc).
    useLayoutEffect(() => {
        const cm = edRef.current?.cm
        if (!cm) return
        const doc = cm.state.doc.toString()
        if (doc !== props.value) cm.dispatch({changes: changedRange(doc, props.value)})
    }, [props.value])

    useEffect(() => {
        edRef.current?.cm.dispatch({effects: editable.current.reconfigure(EditorView.editable.of(!props.readOnly))})
    }, [props.readOnly])

    return <div ref={hostRef} className={`ts-editor-text ${props.className}`}/>
}
