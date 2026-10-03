// The inline editor shared by Append and Alt-Edit (EDITOR.md §3): outline section, optional
// content section, live preview and footer hints. Sits at the top of Quick Add, keyed by
// session, with its `[[` link results (LinkResults) filling the modal below it.
import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {htmlToMarkdown, Notice, Platform, Scope, type Modifier} from "obsidian";
import {attachmentExt, attachmentKind, attachmentName, reverseMarkdownParsing} from "@mdtree/core";
import {GlobalAtoms} from "../react-context/global";
import {SearchViewMolecule} from "../react-context/state";
import {leaveQuickAddAtom} from "../react-context/quick-add-flow";
import {openFileByName} from "../../obsidian-utils";
import {newNotePath, pasteAttachment, trashSessionAttachments} from "../../editing/vault-edits";
import type {TreeNode} from "../search/SearchViewFlatten";
import {EditorMolecule, editorHintsFor, isSaveBlocked, type EditorState} from "./EditorMolecule";
import {basenameOf} from "./draft";
import {LinkResults, useLinkSuggest, type LinkSuggestState} from "./LinkSuggest";
import {MarkdownLine} from "./MarkdownLine";
import {MarkdownField, type MarkdownFieldHandle} from "./MarkdownField";
import {autoConvertHtml} from "./obsidian-editor";
import {
    acceptLink,
    ensureBullet,
    firstLinkOnLine,
    insertAtCaret,
    insertAttachmentBullets,
    linkAt,
    outlineBackspace,
    outlineBaseNote,
    outlineEnter,
    outlineIndent,
    pasteLink,
    pasteOutline,
    pastedUrl,
    wrapLink,
    wrapSelection,
    type TextEdit,
} from "./textarea-ops";

type Section = "outline" | "content"

const PREVIEW_LINES = 6

// `Scope.register` matches any modifiers when given null (obsidian.d.ts only declares arrays).
const ANY_MODIFIERS = null as unknown as Modifier[]

/** Existing buffer key for `name` (links are case-insensitive), else `name`. */
const bufferKey = (contents: Record<string, string>, name: string) =>
    Object.keys(contents).find(k => k.toLowerCase() === name.toLowerCase()) ?? name

/** Text of the clipboard HTML's only `<a>` whose href is `url` (ignoring one trailing "/"), else "". */
function clipboardLinkTitle(html: string, url: string): string {
    const anchors = new DOMParser().parseFromString(html, "text/html").querySelectorAll("a[href]")
    if (anchors.length !== 1) return ""
    const strip = (s: string) => s.trim().replace(/\/$/, "")
    if (strip(anchors[0].getAttribute("href")!) !== strip(url)) return ""
    const t = (anchors[0].textContent ?? "").replace(/\s+/g, " ").trim()
    return t === "" || strip(t) === strip(url) ? "" : t
}

export function InlineEditor({state}: { state: EditorState }) {
    const {updateEditorAtom, cancelEditorAtom, saveEditorAtom} = useMolecule(EditorMolecule)
    const update = useSetAtom(updateEditorAtom)
    const cancel = useSetAtom(cancelEditorAtom)
    const save = useSetAtom(saveEditorAtom)
    const app = useAtomValue(GlobalAtoms.appAtom)
    const leave = useSetAtom(leaveQuickAddAtom)
    const {searchQueryAtom, arrowDownAtom, arrowUpAtom, selectedNodeAtom, renderableTreeNodesAtom} = useMolecule(SearchViewMolecule)
    const setQuery = useSetAtom(searchQueryAtom)
    const arrowDown = useSetAtom(arrowDownAtom)
    const arrowUp = useSetAtom(arrowUpAtom)
    const picked = useAtomValue(selectedNodeAtom)
    const rowCount = useAtomValue(renderableTreeNodesAtom).length

    const rootRef = useRef<HTMLDivElement>(null)
    const outlineRef = useRef<MarkdownFieldHandle | null>(null)
    const contentRef = useRef<MarkdownFieldHandle | null>(null)
    const fieldOf = (s: Section) => s === "outline" ? outlineRef.current : contentRef.current
    // Mod+Shift+V was pressed: the paste that follows takes the clipboard's plain text.
    const plainPaste = useRef(false)
    const pending = useRef<{ section: Section; start: number; end: number } | null>(null)
    const alive = useRef(false)
    const escapeRef = useRef<() => void>(() => {})
    const scopeKeyRef = useRef<(ev: KeyboardEvent) => boolean>(() => false)

    const [focused, setFocused] = useState<Section>("outline")
    const [contentCaret, setContentCaret] = useState(0)

    const append = state.mode === "append"
    const parentName = state.parentName ?? ""
    const active = state.activeContent
    const contentText = active !== null ? state.contents[active] ?? "" : ""

    const outlineSuggest = useLinkSuggest(state.outline, state.caret, focused === "outline")
    const contentSuggest = useLinkSuggest(contentText, contentCaret, focused === "content" && active !== null)

    const hintDeps = [app, state.outline, state.contents, state.contentOrder, state.attachments, state.mode, state.editKind, state.parentName]
    const hints = useMemo(() => editorHintsFor(app, state), hintDeps)
    const blocked = useMemo(() => isSaveBlocked(app, state), hintDeps)

    // Where new notes created by this editor go (next to today's daily note, or the edited file).
    const contentSourcePath = (name: string) =>
        app.metadataCache.getFirstLinkpathDest(name, "")?.path ?? newNotePath(app, name, state.sourcePath)

    // Escape and the fields' own keys are claimed through an Obsidian Scope, pushed only while focus
    // is inside the editor so Escape elsewhere (e.g. in a note) keeps its meaning. Escape must not
    // close the modal; the other keys must beat Obsidian's hotkeys, which run before the field's
    // listeners and treat the field as a markdown editor (Mod+B, Mod+I, Alt+Enter run editor commands).
    const scopeRef = useRef<Scope | null>(null)
    const scopePushed = useRef(false)
    const pushScope = () => {
        if (scopePushed.current || !scopeRef.current) return
        app.keymap.pushScope(scopeRef.current)
        scopePushed.current = true
    }
    const popScope = () => {
        if (!scopePushed.current || !scopeRef.current) return
        app.keymap.popScope(scopeRef.current)
        scopePushed.current = false
    }

    // ── Mount: focus, Escape scope; an Alt-Edit session ends on unmount ───────
    useEffect(() => {
        alive.current = true
        const scope = new Scope(app.scope)
        scope.register([], "Escape", () => {
            escapeRef.current()
            return false
        })
        // Unhandled keys (undefined) fall through to the field and Obsidian's hotkeys.
        scope.register(ANY_MODIFIERS, null, ev => scopeKeyRef.current(ev) ? false : undefined)
        scopeRef.current = scope

        const h = outlineRef.current
        if (h) {
            h.focus()
            h.setSelection(Math.min(state.caret, h.text().length))
        }
        if (rootRef.current?.contains(document.activeElement)) pushScope()

        // The Append draft outlives Quick Add (until saved or discarded); an Alt-Edit session does not.
        const {sessionId, mode} = state
        return () => {
            popScope()
            scopeRef.current = null
            alive.current = false
            // StrictMode re-mounts synchronously; only a real unmount leaves `alive` false.
            if (mode === "edit") queueMicrotask(() => { if (!alive.current) void cancel(sessionId) })
        }
    }, [])

    // Apply caret/selection changes requested by text operations.
    useLayoutEffect(() => {
        const p = pending.current
        if (!p) return
        const h = fieldOf(p.section)
        if (!h) return
        pending.current = null
        h.focus()
        h.setSelection(p.start, p.end)
        setCaret(p.section, p.start)
    })

    const suggestFor = (section: Section): LinkSuggestState => section === "outline" ? outlineSuggest : contentSuggest
    const suggest = suggestFor(focused)

    // Quick Add's results list follows the open `[[query` of the focused field.
    useEffect(() => setQuery({query: suggest.open ? suggest.query : ""}), [suggest.open, suggest.query])

    /** Escape / ✕ / backdrop: close Quick Add; the Append draft stays for next time. */
    const close = () => leave({kind: "cancelled"})
    /** Discard (Cancel for Alt-Edit): drop the session and its pasted attachments, then close. */
    const discard = () => {
        void cancel()
        close()
    }

    escapeRef.current = () => {
        if (outlineSuggest.open) return outlineSuggest.dismiss()
        if (contentSuggest.open) return contentSuggest.dismiss()
        if (active !== null && rootRef.current?.querySelector(".ts-editor-content")?.contains(document.activeElement)) {
            update(s => ({...s, activeContent: null}))
            pending.current = {section: "outline", start: state.caret, end: state.caret}
            setFocused("outline")
            return
        }
        close()
    }

    scopeKeyRef.current = ev => {
        const root = rootRef.current
        const inField = (cls: string) => !!root?.querySelector(cls)?.contains(document.activeElement)
        const section: Section | null = inField(".ts-editor-outline") ? "outline" : inField(".ts-editor-content") ? "content" : null
        return section !== null && onKeyDown(ev, section)
    }

    // ── Text plumbing ─────────────────────────────────────────────────────────
    function setText(section: Section, text: string) {
        if (section === "outline") update(s => ({...s, outline: text}))
        else update(s => s.activeContent === null ? s : {...s, contents: {...s.contents, [s.activeContent]: text}})
    }

    function applyEdit(section: Section, edit: TextEdit) {
        setText(section, edit.text)
        pending.current = {section, start: edit.caret, end: edit.selectionEnd ?? edit.caret}
    }

    function setCaret(section: Section, caret: number) {
        if (section === "outline") update(s => s.caret === caret ? s : {...s, caret})
        else setContentCaret(caret)
    }

    /** The field's text and selection, read from the editor (the model can lag an IME composition). */
    function fieldState(h: MarkdownFieldHandle) {
        return {text: h.text(), ...h.selection()}
    }

    function openContent(name: string) {
        update(s => {
            const key = bufferKey(s.contents, name)
            return {
                ...s,
                contents: key in s.contents ? s.contents : {...s.contents, [key]: ""},
                contentOrder: s.contentOrder.includes(key) ? s.contentOrder : [...s.contentOrder, key],
                activeContent: key,
            }
        })
        const buffer = state.contents[bufferKey(state.contents, name)] ?? ""
        pending.current = {section: "content", start: buffer.length, end: buffer.length}
        setFocused("content")
    }

    function closeContent() {
        update(s => {
            if (s.activeContent === null) return s
            const {[s.activeContent]: _dropped, ...contents} = s.contents
            return {...s, contents, contentOrder: s.contentOrder.filter(k => k !== s.activeContent), activeContent: null}
        })
        pending.current = {section: "outline", start: state.caret, end: state.caret}
        setFocused("outline")
    }

    function accept(section: Section, row: TreeNode) {
        const h = fieldOf(section)
        const sug = suggestFor(section)
        if (!h) return
        const {text, start} = fieldState(h)
        let edit = acceptLink(text, sug.start, start, reverseMarkdownParsing(row.node))
        // A pick keeps the Append outline's caret line a list item.
        if (section === "outline" && append) edit = ensureBullet(edit.text, edit.caret)
        applyEdit(section, edit)
    }

    /** Plain Enter in the outline: a new bullet (Append) or save (Edit). */
    function outlinePlainEnter() {
        const h = outlineRef.current
        if (!h) return
        if (append) applyEdit("outline", outlineEnter(h.text(), h.selection().start))
        else void save()
    }

    // ── Keys ──────────────────────────────────────────────────────────────────
    /** True when handled: the field then keeps the key from CodeMirror and Obsidian. */
    function onKeyDown(ev: KeyboardEvent, section: Section): boolean {
        const mod = Platform.isMacOS ? ev.metaKey : ev.ctrlKey
        plainPaste.current = mod && ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "v"
        // Escape goes to the pushed Scope (it must not close the modal).
        // Keys that confirm or edit an IME composition belong to the IME.
        if (ev.key === "Escape" || ev.isComposing) return false
        const h = fieldOf(section)
        if (!h) return false
        const {text, start, end} = fieldState(h)
        const sug = suggestFor(section)

        if (sug.open && rowCount > 0 && picked && !picked.archiveRow) {
            if (ev.key === "ArrowDown") {
                arrowDown()
                return true
            }
            if (ev.key === "ArrowUp") {
                arrowUp()
                return true
            }
            if ((ev.key === "Enter" || ev.key === "Tab") && !ev.shiftKey) {
                accept(section, picked)
                return true
            }
        }

        if (ev.key === "Enter" && (mod || ev.shiftKey)) {
            void save()
            return true
        }
        if (section === "outline" && append && ev.key === "Backspace" && !ev.altKey && !mod && !ev.ctrlKey && !ev.metaKey && start === end) {
            const edit = outlineBackspace(text, start)
            if (edit) {
                applyEdit(section, edit)
                return true
            }
        }
        if (section === "outline" && ev.key === "Enter" && ev.altKey) {
            const name = linkAt(text, start) ?? firstLinkOnLine(text, start) ?? (append && parentName ? parentName : null)
            if (name) openContent(name)
            return true
        }
        // In the content section Enter is Obsidian's (it continues lists).
        if (ev.key === "Enter" && section === "outline") {
            outlinePlainEnter()
            return true
        }
        if (ev.key === "Tab" && section === "outline" && append) {
            applyEdit(section, outlineIndent(text, start, ev.shiftKey ? -1 : 1))
            return true
        }
        if (mod && !ev.altKey && !ev.shiftKey) {
            const key = ev.key.toLowerCase()
            if (key === "b" || key === "i") {
                const mark = key === "b" ? "**" : "*"
                applyEdit(section, wrapSelection(text, start, end, mark, mark))
                return true
            }
            if (key === "k") {
                applyEdit(section, wrapLink(text, start, end))
                return true
            }
        }
        return false
    }

    /** A rendered `[[link]]` at `pos` was clicked: Mod opens the note, otherwise its content buffer opens. */
    function onLinkClick(section: Section, pos: number, mod: boolean): boolean {
        const h = fieldOf(section)
        const name = h ? linkAt(h.text(), pos) : null
        if (!name) return false
        if (mod) void openFileByName(app, name)
        else if (section === "outline" || bufferKey(state.contents, name) !== active) openContent(name)
        return true
    }

    // ── Paste ─────────────────────────────────────────────────────────────────
    async function pasteFiles(section: Section, files: File[], text: string, caret: number) {
        let base: string
        let sourcePath: string
        if (section === "content" && active !== null) {
            base = active
            sourcePath = contentSourcePath(active)
        } else if (append) {
            base = outlineBaseNote(text, caret, parentName)
            sourcePath = state.sourcePath
        } else {
            base = firstLinkOnLine(text, caret) ?? basenameOf(state.sourcePath)
            sourcePath = state.sourcePath
        }

        const taken = [...state.attachments]
        const names: string[] = []
        for (const file of files) {
            const kind = attachmentKind(file.type)
            const ext = attachmentExt(file.name, file.type)
            const name = attachmentName(base, kind, ext, n =>
                !!app.metadataCache.getFirstLinkpathDest(n, "") || taken.some(a => a.name.toLowerCase() === n.toLowerCase()))
            let att
            try {
                att = await pasteAttachment(app, file, name, sourcePath)
            } catch (err) {
                new Notice(err instanceof Error ? err.message : String(err))
                continue
            }
            if (!alive.current) {
                // The editor closed while the file was being written.
                await trashSessionAttachments(app, [att])
                return
            }
            taken.push(att)
            update(s => ({...s, attachments: [...s.attachments, att]}))
            names.push(att.name)
        }
        if (names.length === 0) return

        const h = fieldOf(section)
        const current = h ? h.text() : text
        const at = Math.min(caret, current.length)
        if (section === "outline" && append) applyEdit(section, insertAttachmentBullets(current, at, names))
        else applyEdit(section, insertAtCaret(current, at, names.map(n => `![[${n}]]`).join(section === "outline" ? " " : "\n")))
    }

    /** Files become session attachments; a pasted URL becomes a markdown link (EDITOR.md §3.8); outline text
     *  is re-shaped (§3.2). True when handled; otherwise Obsidian's own paste runs. */
    function onPaste(ev: ClipboardEvent, section: Section): boolean {
        const plain = plainPaste.current
        plainPaste.current = false
        const h = fieldOf(section)
        if (!h) return false
        const {text, start, end} = fieldState(h)
        const files = Array.from(ev.clipboardData?.files ?? [])
        if (files.length > 0) {
            void pasteFiles(section, files, text, start)
            return true
        }
        const url = plain ? null : pastedUrl(ev.clipboardData?.getData("text/plain") ?? "")
        if (url !== null) {
            const html = ev.clipboardData?.getData("text/html") ?? ""
            const edit = pasteLink(text, start, end, url, html === "" ? "" : clipboardLinkTitle(html, url))
            if (edit) {
                applyEdit(section, edit)
                return true
            }
        }
        if (section === "content") return false
        const html = plain ? "" : ev.clipboardData?.getData("text/html") ?? ""
        const pasted = (html !== "" && autoConvertHtml(app) ? htmlToMarkdown(html) : ev.clipboardData?.getData("text/plain") ?? "")
            .replace(/\r\n?/g, "\n")
        if (append) {
            const edit = pasteOutline(text, start, end, pasted)
            if (edit) applyEdit("outline", edit)
        } else if (pasted !== "") {
            applyEdit("outline", insertAtCaret(text.slice(0, start) + text.slice(end), start, pasted.replace(/\n/g, " ")))
        }
        return true
    }

    function onDropFiles(section: Section, files: File[]) {
        const h = fieldOf(section)
        if (h) void pasteFiles(section, files, h.text(), h.selection().start)
    }

    // ── Render ────────────────────────────────────────────────────────────────
    const fieldProps = (section: Section) => ({
        app,
        readOnly: state.saving,
        sourcePath: section === "outline" || active === null ? state.sourcePath : contentSourcePath(active),
        onText: (text: string, caret: number) => {
            setText(section, text)
            setCaret(section, caret)
        },
        onCaret: (caret: number) => setCaret(section, caret),
        onEnter: () => {
            if (section !== "outline") return false
            outlinePlainEnter()
            return true
        },
        onKeyDown: (ev: KeyboardEvent) => onKeyDown(ev, section),
        onPaste: (ev: ClipboardEvent) => onPaste(ev, section),
        onDropFiles: (files: File[]) => onDropFiles(section, files),
        onLinkClick: (pos: number, mod: boolean) => onLinkClick(section, pos, mod),
        onFocus: () => setFocused(section),
    })

    const chips = state.contentOrder.filter(k => (state.contents[k] ?? "").trim() !== "" || k === active)
    const previewText = (focused === "content" && active !== null ? contentText : state.outline)
        .split("\n").slice(0, PREVIEW_LINES).join("\n")
    const previewSource = focused === "content" && active !== null ? contentSourcePath(active) : state.sourcePath

    return <>
    <div
        className="ts-inline-editor"
        ref={rootRef}
        onFocus={pushScope}
        onBlur={ev => { if (!rootRef.current?.contains(ev.relatedTarget as Node | null)) popScope() }}
    >
        <div className="ts-editor-field">
            <MarkdownField
                handleRef={outlineRef}
                className="ts-editor-outline"
                value={state.outline}
                {...fieldProps("outline")}
            />
        </div>

        {active !== null && <div className="ts-editor-content-section">
            <div className="ts-editor-content-header">
                <span>Content for [[{active}]]</span>
                {chips.map(k => <span
                    key={k}
                    className={`ts-editor-chip ${k === active ? "is-active" : ""}`}
                    onMouseDown={ev => ev.preventDefault()}
                    onClick={() => openContent(k)}
                >[[{k}]]</span>)}
                <button className="ts-editor-close clickable-icon" aria-label="Close content" onClick={closeContent}>✕</button>
            </div>
            <div className="ts-editor-field">
                <MarkdownField
                    key={active}
                    handleRef={contentRef}
                    className="ts-editor-content"
                    value={contentText}
                    {...fieldProps("content")}
                />
            </div>
        </div>}

        {previewText.trim() !== "" && <div className="ts-editor-preview">
            <MarkdownLine app={app} text={previewText} sourcePath={previewSource}/>
        </div>}

        <div className="ts-editor-footer">
            <div className="ts-editor-hints">
                {hints.map((h, i) => <div key={i} className={`ts-editor-hint ${h.blocking ? "is-blocking" : ""}`}>{h.text}</div>)}
            </div>
            <div className="ts-editor-buttons">
                <button className="ts-editor-button" onClick={discard}>{append ? "Discard" : "Cancel"}</button>
                <button className="ts-editor-button ts-editor-save" disabled={blocked || state.saving} onClick={() => void save()}>Save</button>
            </div>
        </div>
    </div>
    <LinkResults open={suggest.open} query={suggest.query} onPick={row => { if (!row.archiveRow) accept(focused, row) }}/>
    </>
}
