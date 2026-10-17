// The inline editor shared by prose, Rename and filter names (EDITOR.md §3): title, outline section, optional
// content section, live preview and footer hints. Shown in place by the Search modal and pane, keyed by
// session, with its link results (LinkResults: `[[` matches, else the caret line's note tree or the daily outline)
// filling the view below it.
import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {htmlToMarkdown, Notice, Platform, Scope} from "obsidian";
import {Brackets, ClipboardPaste, IndentDecrease, IndentIncrease, ListTodo, Paperclip} from "lucide-react";
import {applyDateSuggestion, attachmentExt, attachmentKind, attachmentName, newLinkName, reverseMarkdownParsing, type DateSuggestion} from "@mdtree/core";
import {GlobalAtoms} from "../react-context/global";
import {quickAddDefaultQuery, SearchViewMolecule} from "../react-context/state";
import {openFileByName} from "../../obsidian-utils";
import {newNotePath, pasteAttachment, trashSessionAttachments} from "../../editing/vault-edits";
import type {TreeNode} from "../search/SearchViewFlatten";
import {EditorMolecule, editorHintsFor, isSaveBlocked, type EditorState} from "./EditorMolecule";
import {basenameOf, editorTitle} from "./draft";
import {searchFiltersAtom} from "../react-context/settings";
import {filterIndexNamed} from "../search/search-filter";
import {LinkResults, useLinkSuggest, type LinkSuggestState} from "./LinkSuggest";
import {useDateSuggest} from "./date-suggest";
import {SearchAutocomplete} from "../search/SearchAutocomplete";
import {MarkdownLine} from "./MarkdownLine";
import {ANY_MODIFIERS, MarkdownField, type MarkdownFieldHandle} from "./MarkdownField";
import {autoConvertHtml} from "./obsidian-editor";
import {linkPasteEdit} from "./clipboard";
import {
    acceptLink,
    firstLinkOnLine,
    insertAtCaret,
    linkAt,
    caretNote,
    outlineEnter,
    outlineIndent,
    shouldAppendLineOnEnter,
    toggleTask,
    wrapLink,
    wrapSelection,
    type PasteData,
    type TextEdit,
} from "./textarea-ops";

type Section = "outline" | "content"

const PREVIEW_LINES = 6

/** Existing buffer key for `name` (links are case-insensitive), else `name`. */
const bufferKey = (contents: Record<string, string>, name: string) =>
    Object.keys(contents).find(k => k.toLowerCase() === name.toLowerCase()) ?? name

/** Where the `@` popup opens in the field box: under the character at `pos`. */
export function popupAt(h: MarkdownFieldHandle | null, box: HTMLElement | null, pos: number): {left: number; top: number} | undefined {
    const c = h?.coordsAt(pos)
    if (!c || !box) return undefined
    const r = box.getBoundingClientRect()
    return {left: c.left - r.left, top: c.bottom - r.top}
}

/** The clipboard as paste data, for the toolbar's Paste. Non-text items become Files named "" (attachmentExt then
 *  takes the extension from the MIME type). Where `clipboard.read` is missing or denied, plain text only via
 *  `readText`; throws when that fails too. */
async function readClipboard(): Promise<PasteData> {
    let items: ClipboardItems
    try {
        // First await: iOS only allows it synchronously inside the tap's user gesture.
        items = await navigator.clipboard.read()
    } catch {
        return {files: [], plain: await navigator.clipboard.readText(), html: ""}
    }
    const data: PasteData = {files: [], plain: "", html: ""}
    let plainSeen = false
    let htmlSeen = false
    for (const item of items) {
        for (const type of item.types) {
            if (type === "text/plain") {
                if (plainSeen) continue
                plainSeen = true
                data.plain = await (await item.getType(type)).text()
            } else if (type === "text/html") {
                if (htmlSeen) continue
                htmlSeen = true
                data.html = await (await item.getType(type)).text()
            } else if (!type.startsWith("text/")) {
                data.files.push(new File([await item.getType(type)], "", {type}))
            }
        }
    }
    return data
}

export function InlineEditor({state}: { state: EditorState }) {
    const {updateEditorAtom, cancelEditorAtom, saveEditorAtom, closeEditorAtom, openProseAtom} = useMolecule(EditorMolecule)
    const update = useSetAtom(updateEditorAtom)
    const cancel = useSetAtom(cancelEditorAtom)
    const save = useSetAtom(saveEditorAtom)
    const app = useAtomValue(GlobalAtoms.appAtom)
    const closeEditor = useSetAtom(closeEditorAtom)
    const openProse = useSetAtom(openProseAtom)
    const {searchQueryAtom, arrowDownAtom, arrowUpAtom, selectedNodeAtom, selectedLineAtom, renderableTreeNodesAtom, lastResultsAtom, searchModalTitleAtom} = useMolecule(SearchViewMolecule)
    const hostTitle = useAtomValue(searchModalTitleAtom)
    const setQuery = useSetAtom(searchQueryAtom)
    const arrowDown = useSetAtom(arrowDownAtom)
    const arrowUp = useSetAtom(arrowUpAtom)
    const selectLine = useSetAtom(selectedLineAtom)
    const picked = useAtomValue(selectedNodeAtom)
    const rows = useAtomValue(renderableTreeNodesAtom)
    const rowCount = rows.length
    const targets = useAtomValue(lastResultsAtom).results
    const graph = useAtomValue(GlobalAtoms.graphAtom)

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
    const fileInputRef = useRef<HTMLInputElement>(null)

    const [focused, setFocused] = useState<Section>("outline")
    const [contentCaret, setContentCaret] = useState(0)

    /** Prose mode: the whole note as Markdown; keys, paste and links behave as in a content section. */
    const prose = state.mode === "prose"
    /** Rename of an attachment, or a new filter's name: the outline holds a name; no pastes of files, links or preview. */
    const renaming = state.editKind === "file" || state.editKind === "filter"
    const active = state.activeContent
    const contentText = active !== null ? state.contents[active] ?? "" : ""

    const outlineSuggest = useLinkSuggest(state.outline, state.caret, focused === "outline")
    const contentSuggest = useLinkSuggest(contentText, contentCaret, focused === "content" && active !== null)
    const dateSuggest = useDateSuggest(state.outline, state.caret, focused === "outline", "")
    const outlineFieldRef = useRef<HTMLDivElement>(null)

    const filters = useAtomValue(searchFiltersAtom)
    const hintDeps = [app, state.outline, state.contents, state.contentOrder, state.attachments, state.mode, state.editKind, state.parentName, state.prose, state.proseConfirmed, filters]
    const hints = useMemo(() => editorHintsFor(app, state, filters), hintDeps)
    const blocked = useMemo(() => isSaveBlocked(app, state, filters), hintDeps)
    /** Save as Filter under an existing filter's name: Save replaces that filter (a Rename Filter never does). */
    const replacing = state.editKind === "filter" && state.originalLine === undefined && filterIndexNamed(state.outline, filters) >= 0

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

    // ── Mount: focus, Escape scope; a Rename, filter or prose session ends on unmount ──
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

        const {sessionId} = state
        return () => {
            popScope()
            scopeRef.current = null
            alive.current = false
            // StrictMode re-mounts synchronously; only a real unmount leaves `alive` false.
            queueMicrotask(() => { if (!alive.current) void cancel(sessionId) })
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
    /** Name the New note row links, while a `[[query` is open in the focused field. */
    const newName = useMemo(() => suggest.open ? newLinkName(graph, suggest.query, targets) : null, [suggest.open, suggest.query, targets, graph])
    /** The New note row is selected exactly when it shows and no result row is selected (none exist, or ArrowUp left row 0). */
    const newSelected = newName !== null && picked === null

    // The outline's note nearest its caret (caretNote: the caret line's link nearest the caret, else the nearest
    // ancestor line's), so the list follows the caret and edits to the links around it.
    const caretParent = caretNote(state.outline, state.caret) ?? undefined
    // The results list follows the open `[[query` of the focused field, else shows that note's full tree (`[[P]]`),
    // or today's daily outline.
    useEffect(() => setQuery({query: suggest.open ? `[[${suggest.query}` : quickAddDefaultQuery(caretParent)}),
        [suggest.open, suggest.query, caretParent])

    /** Escape / ✕ / backdrop: close the editor, back to the search. */
    const close = () => closeEditor({kind: "cancelled"})
    /** Discard (Cancel for Rename and filters): drop the session and its pasted attachments, then close. */
    const discard = () => {
        void cancel()
        close()
    }

    escapeRef.current = () => {
        if (dateSuggest.items.length > 0) return dateSuggest.dismiss()
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
        if (prose) return
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

    /** A picked row: replaces the open `[[query`, or (daily outline, no `[[` open) inserts a note/heading link at the caret. */
    function accept(section: Section, row: TreeNode) {
        if (!fieldOf(section)) return
        if (!suggestFor(section).open && row.node.nodeType !== "page" && row.node.nodeType !== "header") return
        insertLink(section, reverseMarkdownParsing(row.node))
    }

    /** A picked `@` date: replaces the `@word` with the task's `[scheduled:: date]`. */
    function acceptDate(s: DateSuggestion) {
        const h = outlineRef.current
        if (h) applyEdit("outline", applyDateSuggestion(h.text(), s))
    }

    /** Puts `link` in place of the open `[[query` (and a `]]` right after the caret), else at the caret. */
    function insertLink(section: Section, link: string) {
        const h = fieldOf(section)
        if (!h) return
        const sug = suggestFor(section)
        const {text, start} = fieldState(h)
        applyEdit(section, sug.open ? acceptLink(text, sug.start, start, link) : insertAtCaret(text, start, link))
    }

    // ── Mobile toolbar ────────────────────────────────────────────────────────
    /** Section the toolbar acts on: the content field when open and last focused, else the outline. */
    const toolSection: Section = focused === "content" && active !== null ? "content" : "outline"
    /** Task, Indent and Outdent act on list lines: the content section only. */
    const canEditPrefix = toolSection === "content"

    /** Toolbar Insert link: wraps the selection in `[[…]]` (empty: `[[]]`), caret before `]]`, so the link results open on the text inside. */
    function insertLinkBrackets() {
        const h = fieldOf(toolSection)
        if (!h) return
        const {text, start, end} = fieldState(h)
        applyEdit(toolSection, {...wrapSelection(text, start, end, "[[", "]]"), caret: end + 2, selectionEnd: undefined})
    }

    /** Toolbar Task: the caret line becomes a `- [ ] ` task, or loses its checkbox (toggleTask). */
    function toggleTaskLine() {
        const h = fieldOf(toolSection)
        if (!h || !canEditPrefix) return
        const {text, start} = fieldState(h)
        applyEdit(toolSection, toggleTask(text, start))
    }

    /** Toolbar Indent / Outdent: Tab / Shift+Tab of the focused field. */
    function indentLine(dir: 1 | -1) {
        const h = fieldOf(toolSection)
        if (!h || !canEditPrefix) return
        if (toolSection === "content") {
            h.indent(dir)
            h.focus()
            return
        }
        const {text, start} = fieldState(h)
        applyEdit("outline", outlineIndent(text, start, dir))
    }

    /** Toolbar Paste: the clipboard through pasteInto, as if pasted into the focused field. */
    async function pasteFromClipboard() {
        const section = toolSection
        let data: PasteData
        try {
            data = await readClipboard()
        } catch (err) {
            new Notice(`Can't read the clipboard: ${err instanceof Error ? err.message : String(err)}`)
            return
        }
        if (!alive.current) return
        if (data.files.length === 0 && data.plain === "" && data.html === "") {
            new Notice("The clipboard is empty")
            return
        }
        pasteInto(section, data, false, false)
    }

    /** Files chosen with the toolbar's Attach: attached like a paste or drop (§3.5). */
    function onPickFiles(ev: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(ev.currentTarget.files ?? [])
        ev.currentTarget.value = ""   // picking the same file again fires change again
        if (files.length > 0) onDropFiles(toolSection, files)
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

        if (section === "outline" && dateSuggest.items.length > 0 && !ev.altKey && !mod) {
            if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
                dateSuggest.move(ev.key === "ArrowDown" ? 1 : -1)
                return true
            }
            if ((ev.key === "Enter" || ev.key === "Tab") && !ev.shiftKey) {
                acceptDate(dateSuggest.items[dateSuggest.index])
                return true
            }
        }

        const sectionNew = section === focused ? newName : null
        if (sug.open && (rowCount > 0 || sectionNew !== null)) {
            if (rowCount > 0 && ev.key === "ArrowDown") {
                arrowDown()   // from the New note row (line -1) this selects the first visible row
                return true
            }
            if (rowCount > 0 && ev.key === "ArrowUp") {
                if (sectionNew !== null && picked !== null && picked.index === rows[0].index) selectLine(-1)
                else if (picked !== null) arrowUp()
                return true
            }
            if ((ev.key === "Enter" || ev.key === "Tab") && !ev.shiftKey) {
                if (sectionNew !== null && picked === null) insertLink(section, `[[${sectionNew}]]`)
                else if (picked && !picked.archiveRow) accept(section, picked)
                return true
            }
        }

        if (ev.key === "Enter" && (mod || ev.shiftKey)) {
            void save()
            return true
        }
        if (ev.key === "Enter" && shouldAppendLineOnEnter(state.mode, section, ev.altKey, mod, ev.shiftKey)) {
            const selectedTextReplaced = text.slice(0, start) + text.slice(end)
            applyEdit(section, outlineEnter(selectedTextReplaced, start))
            return true
        }
        if (section === "outline" && !prose && ev.key === "Enter" && ev.altKey) {
            if (renaming) return true
            const name = linkAt(text, start) ?? firstLinkOnLine(text, start)
            if (name) openContent(name)
            return true
        }
        // In the content section Enter is Obsidian's (it continues lists).
        if (ev.key === "Enter" && section === "outline" && !prose) {
            void save()
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
        if (renaming) return
        let base: string
        let sourcePath: string
        if (section === "content" && active !== null) {
            base = active
            sourcePath = contentSourcePath(active)
        } else {
            base = caretNote(text, caret) ?? basenameOf(state.sourcePath)
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
        applyEdit(section, insertAtCaret(current, at, names.map(n => `![[${n}]]`).join(section === "outline" && !prose ? " " : "\n")))
    }

    function onPaste(ev: ClipboardEvent, section: Section): boolean {
        const plainOnly = plainPaste.current
        plainPaste.current = false
        const cd = ev.clipboardData
        return pasteInto(section, {files: Array.from(cd?.files ?? []), plain: cd?.getData("text/plain") ?? "", html: cd?.getData("text/html") ?? ""}, plainOnly, true)
    }

    /** Files become session attachments (EDITOR.md §3.5); a URL becomes a markdown link (§3.8) unless `plainOnly`;
     *  outline text is re-shaped (§3.2). `native`: called from the field's paste event, where false lets Obsidian's
     *  own paste run (content section text); the toolbar inserts that text itself. True when handled. */
    function pasteInto(section: Section, data: PasteData, plainOnly: boolean, native: boolean): boolean {
        const h = fieldOf(section)
        if (!h) return false
        const {text, start, end} = fieldState(h)
        if (data.files.length > 0) {
            void pasteFiles(section, data.files, text, start)
            return true
        }
        const link = plainOnly ? null : linkPasteEdit(text, start, end, data)
        if (link) {
            applyEdit(section, link)
            return true
        }
        const pasted = (!plainOnly && data.html !== "" && autoConvertHtml(app) ? htmlToMarkdown(data.html) : data.plain)
            .replace(/\r\n?/g, "\n")
        if (section === "content" || prose) {
            if (native) return false
            if (pasted !== "") applyEdit(section, insertAtCaret(text.slice(0, start) + text.slice(end), start, pasted))
            return true
        }
        if (pasted !== "") {
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
            if (section !== "outline" || prose) return false
            if (state.mode === "append") {
                const h = outlineRef.current
                if (!h) return false
                const {text, start, end} = fieldState(h)
                applyEdit("outline", outlineEnter(text.slice(0, start) + text.slice(end), start))
                return true
            }
            void save()
            return true
        },
        onBackspace: () => false,
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
        className={`ts-inline-editor${prose ? " ts-editor-prose" : ""}`}
        ref={rootRef}
        onFocus={pushScope}
        onBlur={ev => { if (!rootRef.current?.contains(ev.relatedTarget as Node | null)) popScope() }}
    >
        {/* The Search modal's title already names a Rename or filter session. */}
        {editorTitle(state) !== hostTitle && <div className="ts-editor-title">{editorTitle(state)}</div>}
        <div className="ts-editor-field" ref={outlineFieldRef}>
            <MarkdownField
                handleRef={outlineRef}
                className="ts-editor-outline"
                value={state.outline}
                {...fieldProps("outline")}
            />
            {dateSuggest.items.length > 0 && <SearchAutocomplete
                suggestions={dateSuggest.items}
                highlightedIndex={dateSuggest.index}
                onHover={dateSuggest.setIndex}
                onAccept={s => acceptDate(s as DateSuggestion)}
                at={popupAt(outlineRef.current, outlineFieldRef.current, dateSuggest.items[0].start)}
            />}
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

        {Platform.isMobile && !renaming && <div className="ts-editor-toolbar">
            <button className="ts-editor-tool clickable-icon" aria-label="Insert link" disabled={state.saving}
                onMouseDown={ev => ev.preventDefault()} onClick={insertLinkBrackets}><Brackets size={18}/></button>
            <button className="ts-editor-tool clickable-icon" aria-label="Task" disabled={state.saving || !canEditPrefix}
                onMouseDown={ev => ev.preventDefault()} onClick={toggleTaskLine}><ListTodo size={18}/></button>
            <button className="ts-editor-tool clickable-icon" aria-label="Indent" disabled={state.saving || !canEditPrefix}
                onMouseDown={ev => ev.preventDefault()} onClick={() => indentLine(1)}><IndentIncrease size={18}/></button>
            <button className="ts-editor-tool clickable-icon" aria-label="Outdent" disabled={state.saving || !canEditPrefix}
                onMouseDown={ev => ev.preventDefault()} onClick={() => indentLine(-1)}><IndentDecrease size={18}/></button>
            <button className="ts-editor-tool clickable-icon" aria-label="Paste" disabled={state.saving}
                onMouseDown={ev => ev.preventDefault()} onClick={() => void pasteFromClipboard()}><ClipboardPaste size={18}/></button>
            <button className="ts-editor-tool clickable-icon" aria-label="Attach file" disabled={state.saving}
                onMouseDown={ev => ev.preventDefault()} onClick={() => fileInputRef.current?.click()}><Paperclip size={18}/></button>
            <input ref={fileInputRef} type="file" multiple hidden onChange={onPickFiles}/>
        </div>}

        {!prose && !renaming && previewText.trim() !== "" && <div className="ts-editor-preview">
            <MarkdownLine app={app} text={previewText} sourcePath={previewSource}/>
        </div>}

        <div className="ts-editor-footer">
            <div className="ts-editor-hints">
                {hints.map((h, i) => <div key={i} className={`ts-editor-hint ${h.blocking ? "is-blocking" : ""}`}>{h.text}</div>)}
            </div>
            <div className="ts-editor-buttons">
                <button className="ts-editor-button" onClick={discard}>Cancel</button>
                <button className="ts-editor-button ts-editor-save" disabled={blocked || state.saving} onClick={() => void save()}>{replacing ? "Replace" : "Save"}</button>
            </div>
        </div>
    </div>
    <LinkResults open={suggest.open} query={suggest.query} parentName={caretParent}
        onPick={row => { if (!row.archiveRow) accept(focused, row) }}
        newName={newName} newSelected={newSelected}
        onPickNew={() => { if (newName !== null) insertLink(focused, `[[${newName}]]`) }}/>
    </>
}
