// The inline editor shared by Append and Alt-Edit (EDITOR.md §3): Edit header, outline
// section, optional content section, live preview and footer hints. Rendered at the
// top of the view, above the search box, keyed by session.
import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {Notice, Platform, Scope} from "obsidian";
import {attachmentExt, attachmentKind, attachmentName, reverseMarkdownParsing, type TreeNode as CoreTreeNode} from "@mdtree/core";
import {GlobalAtoms} from "../react-context/global";
import {SearchViewMolecule} from "../react-context/state";
import {openFileByName} from "../../obsidian-utils";
import {newNotePath, pasteAttachment, trashSessionAttachments} from "../../editing/vault-edits";
import {basenameOf, EditorMolecule, editorHintsFor, isSaveBlocked, type EditorState} from "./EditorMolecule";
import {LinkSuggest, useLinkSuggest, type LinkSuggestState} from "./LinkSuggest";
import {MarkdownLine} from "./MarkdownLine";
import {
    acceptLink,
    firstLinkOnLine,
    insertAtCaret,
    insertAttachmentBullets,
    linkAt,
    normalizePastedOutline,
    outlineBackspace,
    outlineBaseNote,
    outlineEnter,
    outlineIndent,
    wrapLink,
    wrapSelection,
    type TextEdit,
} from "./textarea-ops";

type Section = "outline" | "content"

const MAX_ROWS = 8
const PREVIEW_LINES = 6

/** Existing buffer key for `name` (links are case-insensitive), else `name`. */
const bufferKey = (contents: Record<string, string>, name: string) =>
    Object.keys(contents).find(k => k.toLowerCase() === name.toLowerCase()) ?? name

function autoGrow(ta: HTMLTextAreaElement | null) {
    if (!ta) return
    ta.style.height = "auto"
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_ROWS * lineHeight)}px`
}

export function InlineEditor({state}: { state: EditorState }) {
    const {updateEditorAtom, cancelEditorAtom, saveEditorAtom} = useMolecule(EditorMolecule)
    const update = useSetAtom(updateEditorAtom)
    const cancel = useSetAtom(cancelEditorAtom)
    const save = useSetAtom(saveEditorAtom)
    const focusSearch = useSetAtom(useMolecule(SearchViewMolecule).focusSearchInputAtom)
    const app = useAtomValue(GlobalAtoms.appAtom)

    const rootRef = useRef<HTMLDivElement>(null)
    const outlineRef = useRef<HTMLTextAreaElement>(null)
    const contentRef = useRef<HTMLTextAreaElement>(null)
    const pending = useRef<{ section: Section; start: number; end: number } | null>(null)
    const alive = useRef(false)
    const escapeRef = useRef<() => void>(() => {})

    const [focused, setFocused] = useState<Section>("outline")
    const [outlineCaret, setOutlineCaret] = useState(state.outline.length)
    const [contentCaret, setContentCaret] = useState(0)

    const append = state.mode === "append"
    const parentName = state.parentName ?? ""
    const active = state.activeContent
    const contentText = active !== null ? state.contents[active] ?? "" : ""

    const outlineSuggest = useLinkSuggest(state.outline, outlineCaret, focused === "outline")
    const contentSuggest = useLinkSuggest(contentText, contentCaret, focused === "content" && active !== null)

    const hintDeps = [app, state.outline, state.contents, state.contentOrder, state.attachments, state.mode, state.editKind, state.parentName]
    const hints = useMemo(() => editorHintsFor(app, state), hintDeps)
    const blocked = useMemo(() => isSaveBlocked(app, state), hintDeps)

    // Where new notes created by this editor go (next to today's daily note, or the edited file).
    const contentSourcePath = (name: string) =>
        app.metadataCache.getFirstLinkpathDest(name, "")?.path ?? newNotePath(app, name, state.sourcePath)

    // Escape is claimed through an Obsidian Scope (so it doesn't close the modal), pushed only
    // while focus is inside the editor so Escape elsewhere (e.g. in a note) keeps its meaning.
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

    // ── Mount: focus, Escape scope, cancel on unmount ─────────────────────────
    useEffect(() => {
        alive.current = true
        const scope = new Scope(app.scope)
        scope.register([], "Escape", () => {
            escapeRef.current()
            return false
        })
        scopeRef.current = scope

        const ta = outlineRef.current
        if (ta) {
            ta.focus()
            ta.setSelectionRange(ta.value.length, ta.value.length)
        }
        if (rootRef.current?.contains(document.activeElement)) pushScope()

        const sessionId = state.sessionId
        return () => {
            popScope()
            scopeRef.current = null
            alive.current = false
            // StrictMode re-mounts synchronously; only a real unmount leaves `alive` false.
            queueMicrotask(() => { if (!alive.current) void cancel(sessionId) })
        }
    }, [])

    // Re-targeting or re-requesting an open editor focuses the outline end.
    useEffect(() => {
        if (state.focusNonce === 0) return
        const ta = outlineRef.current
        if (!ta) return
        ta.focus()
        ta.setSelectionRange(ta.value.length, ta.value.length)
        setOutlineCaret(ta.value.length)
        setFocused("outline")
    }, [state.focusNonce])

    useLayoutEffect(() => autoGrow(outlineRef.current), [state.outline])
    useLayoutEffect(() => autoGrow(contentRef.current), [contentText, active])

    // Apply caret/selection changes requested by text operations.
    useLayoutEffect(() => {
        const p = pending.current
        if (!p) return
        const ta = p.section === "outline" ? outlineRef.current : contentRef.current
        if (!ta) return
        pending.current = null
        ta.focus()
        ta.setSelectionRange(p.start, p.end)
        if (p.section === "outline") setOutlineCaret(p.start)
        else setContentCaret(p.start)
    })

    const suggestFor = (section: Section): LinkSuggestState => section === "outline" ? outlineSuggest : contentSuggest

    /** User cancel (Escape or the Cancel button): close the editor and hand focus to the search input. */
    const cancelToSearch = () => {
        void cancel()
        focusSearch(n => n + 1)
    }

    escapeRef.current = () => {
        if (outlineSuggest.open) return outlineSuggest.dismiss()
        if (contentSuggest.open) return contentSuggest.dismiss()
        if (document.activeElement === contentRef.current && active !== null) {
            update(s => ({...s, activeContent: null}))
            pending.current = {section: "outline", start: outlineCaret, end: outlineCaret}
            setFocused("outline")
            return
        }
        cancelToSearch()
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

    function trackCaret(section: Section, ta: HTMLTextAreaElement) {
        if (section === "outline") setOutlineCaret(ta.selectionStart)
        else setContentCaret(ta.selectionStart)
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
        pending.current = {section: "outline", start: outlineCaret, end: outlineCaret}
        setFocused("outline")
    }

    function accept(section: Section, row: CoreTreeNode) {
        const ta = section === "outline" ? outlineRef.current : contentRef.current
        const sug = suggestFor(section)
        if (!ta) return
        applyEdit(section, acceptLink(ta.value, sug.start, ta.selectionStart, reverseMarkdownParsing(row.node)))
    }

    // ── Keys ──────────────────────────────────────────────────────────────────
    function onKeyDown(ev: React.KeyboardEvent<HTMLTextAreaElement>, section: Section) {
        // Escape goes to the pushed Scope (it must not close the modal); everything else stays here.
        if (ev.key === "Escape") return
        ev.stopPropagation()
        const ta = ev.currentTarget
        const {value: text, selectionStart: start, selectionEnd: end} = ta
        const mod = Platform.isMacOS ? ev.metaKey : ev.ctrlKey
        const sug = suggestFor(section)

        if (sug.open && sug.rows.length > 0) {
            if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
                ev.preventDefault()
                const n = sug.rows.length
                sug.setSelected((sug.selected + (ev.key === "ArrowDown" ? 1 : n - 1)) % n)
                return
            }
            if ((ev.key === "Enter" || ev.key === "Tab") && !ev.shiftKey) {
                ev.preventDefault()
                accept(section, sug.rows[sug.selected])
                return
            }
        }

        if (ev.key === "Enter" && (mod || ev.shiftKey)) {
            ev.preventDefault()
            void save()
            return
        }
        if (section === "outline" && append && ev.key === "Backspace" && !ev.altKey && !mod && !ev.ctrlKey && !ev.metaKey && start === end) {
            const edit = outlineBackspace(text, start)
            if (edit) {
                ev.preventDefault()
                applyEdit(section, edit)
                return
            }
        }
        if (section === "outline" && ev.key === "Enter" && ev.altKey) {
            ev.preventDefault()
            const name = linkAt(text, start) ?? firstLinkOnLine(text, start) ?? (append && parentName ? parentName : null)
            if (name) openContent(name)
            return
        }
        if (ev.key === "Enter" && section === "outline") {
            ev.preventDefault()
            if (append) applyEdit(section, outlineEnter(text, start))
            else void save()
            return
        }
        if (ev.key === "Tab" && section === "outline" && append) {
            ev.preventDefault()
            applyEdit(section, outlineIndent(text, start, ev.shiftKey ? -1 : 1))
            return
        }
        if (mod && !ev.altKey && !ev.shiftKey) {
            const key = ev.key.toLowerCase()
            if (key === "b" || key === "i") {
                ev.preventDefault()
                const mark = key === "b" ? "**" : "*"
                applyEdit(section, wrapSelection(text, start, end, mark, mark))
            } else if (key === "k") {
                ev.preventDefault()
                applyEdit(section, wrapLink(text, start, end))
            }
        }
    }

    function onClick(ev: React.MouseEvent<HTMLTextAreaElement>, section: Section) {
        const ta = ev.currentTarget
        trackCaret(section, ta)
        const name = linkAt(ta.value, ta.selectionStart)
        if (!name) return
        const mod = Platform.isMacOS ? ev.metaKey : ev.ctrlKey
        if (mod) void openFileByName(app, name)
        else if (section === "outline" || bufferKey(state.contents, name) !== active) openContent(name)
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

        const ta = section === "outline" ? outlineRef.current : contentRef.current
        const current = ta?.value ?? text
        const at = Math.min(caret, current.length)
        if (section === "outline" && append) applyEdit(section, insertAttachmentBullets(current, at, names))
        else applyEdit(section, insertAtCaret(current, at, names.map(n => `![[${n}]]`).join(section === "outline" ? " " : "\n")))
    }

    function onPaste(ev: React.ClipboardEvent<HTMLTextAreaElement>, section: Section) {
        const ta = ev.currentTarget
        const {value, selectionStart: start, selectionEnd: end} = ta
        const files = Array.from(ev.clipboardData.files)
        if (files.length > 0) {
            ev.preventDefault()
            void pasteFiles(section, files, value, start)
            return
        }
        const pasted = ev.clipboardData.getData("text/plain")
        if (section !== "outline" || !pasted.includes("\n")) return
        ev.preventDefault()
        const without = value.slice(0, start) + value.slice(end)
        const insert = append ? normalizePastedOutline(pasted) : pasted.replace(/\r?\n/g, " ")
        applyEdit(section, insertAtCaret(without, start, insert))
    }

    // ── Render ────────────────────────────────────────────────────────────────
    const textareaProps = (section: Section) => ({
        rows: 1,
        readOnly: state.saving,
        spellCheck: true,
        onKeyDown: (ev: React.KeyboardEvent<HTMLTextAreaElement>) => onKeyDown(ev, section),
        onKeyUp: (ev: React.KeyboardEvent<HTMLTextAreaElement>) => trackCaret(section, ev.currentTarget),
        onSelect: (ev: React.SyntheticEvent<HTMLTextAreaElement>) => trackCaret(section, ev.currentTarget),
        onClick: (ev: React.MouseEvent<HTMLTextAreaElement>) => onClick(ev, section),
        onPaste: (ev: React.ClipboardEvent<HTMLTextAreaElement>) => onPaste(ev, section),
        onFocus: () => setFocused(section),
        onChange: (ev: React.ChangeEvent<HTMLTextAreaElement>) => {
            setText(section, ev.currentTarget.value)
            trackCaret(section, ev.currentTarget)
        },
    })

    const chips = state.contentOrder.filter(k => (state.contents[k] ?? "").trim() !== "" || k === active)
    const previewText = (focused === "content" && active !== null ? contentText : state.outline)
        .split("\n").slice(0, PREVIEW_LINES).join("\n")
    const previewSource = focused === "content" && active !== null ? contentSourcePath(active) : state.sourcePath

    return <div
        className="ts-inline-editor"
        ref={rootRef}
        onFocus={pushScope}
        onBlur={ev => { if (!rootRef.current?.contains(ev.relatedTarget as Node | null)) popScope() }}
    >
        {!append && <div className="ts-editor-header">{`Editing ${basenameOf(state.sourcePath)}:${(state.line ?? 0) + 1}`}</div>}

        <div className="ts-editor-field">
            <textarea
                ref={outlineRef}
                className="ts-editor-outline"
                autoFocus
                value={state.outline}
                {...textareaProps("outline")}
            />
            {focused === "outline" && <LinkSuggest state={outlineSuggest} onAccept={row => accept("outline", row)}/>}
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
                <textarea
                    ref={contentRef}
                    className="ts-editor-content"
                    value={contentText}
                    {...textareaProps("content")}
                />
                {focused === "content" && <LinkSuggest state={contentSuggest} onAccept={row => accept("content", row)}/>}
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
                <button className="ts-editor-button" onClick={cancelToSearch}>Cancel</button>
                <button className="ts-editor-button ts-editor-save" disabled={blocked || state.saving} onClick={() => void save()}>Save</button>
            </div>
        </div>
    </div>
}
