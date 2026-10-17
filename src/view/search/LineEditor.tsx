// The outline editor's line editor (docs/superpowers/specs/2026-10-15-outline-editor-design.md §Line editor): an
// outline MarkdownField in place of the edited row (or of the New line row), its prefix (indent, bullet, checkbox or
// `#…`) kept outside it, with the `[[` link targets, the `@` dates and the hints under it. Lines the filter would hide
// get a red outline. Keys typed in it stay out of the view's shortcuts (`.ts-line-editor`, KeyComboWrapper).
import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {useAtomValue, useSetAtom, useStore} from "jotai";
import {useMolecule} from "bunshi/react";
import {htmlToMarkdown, Notice, Platform, Scope} from "obsidian";
import {
    applyDateSuggestion,
    attachmentExt,
    attachmentKind,
    attachmentName,
    blockMisses,
    lineMatches,
    lineNode,
    linkTargetTree,
    newLinkName,
    reverseMarkdownParsing,
    type DateSuggestion,
    type ParsedNode,
    type QueryExpr,
    type ResultNode,
} from "@mdtree/core";
import {GlobalAtoms} from "../react-context/global";
import {SearchViewMolecule} from "../react-context/state";
import {separatorAtom, settingsAtom} from "../react-context/settings";
import {EditorMolecule, lineEditHints} from "../editor/EditorMolecule";
import {ANY_MODIFIERS, MarkdownField, type MarkdownFieldHandle} from "../editor/MarkdownField";
import {useLinkSuggest} from "../editor/LinkSuggest";
import {useDateSuggest} from "../editor/date-suggest";
import {popupAt} from "../editor/InlineEditor";
import {autoConvertHtml} from "../editor/obsidian-editor";
import {linkPasteEdit} from "../editor/clipboard";
import {basenameOf, dailyConfigOf} from "../editor/draft";
import {
    acceptLink,
    caretNote,
    linkAt,
    insertAtCaret,
    insertAttachmentBullets,
    outlineBackspace,
    outlineEnter,
    outlineIndent,
    lineEditorRepairs,
    pasteOutline,
    shouldAppendLineOnEnter,
    wrapLink,
    wrapSelection,
    type TextEdit,
} from "../editor/textarea-ops";
import {openFileByName} from "../../obsidian-utils";
import {dailyNotePath, pasteAttachment, trashSessionAttachments} from "../../editing/vault-edits";
import {SearchAutocomplete} from "./SearchAutocomplete";
import {fieldRawLines, newLineTarget, rootOf, type LineEdit} from "./outline";
import type {TreeNode} from "./SearchViewFlatten";

const MAX_LINK_TARGETS = 50

/** Position of the edited row among `rows` (the row on its line), -1 for the New line or a row not shown. */
export function editedRowPos(rows: readonly TreeNode[], edit: LineEdit | null): number {
    const r = edit?.row
    if (!r) return -1
    return rows.findIndex(t => !t.archiveRow && t.node.location.path === r.path && t.node.location.position.start.line === r.line)
}

/** For each stage: whether a tree ancestor (`above`) or an existing descendant (`below`) of the row at `pos` matches it. */
function treeContext(rows: readonly TreeNode[], pos: number, stages: QueryExpr[]): {above: boolean[]; below: boolean[]} {
    const above = stages.map(() => false)
    const below = stages.map(() => false)
    if (pos < 0) return {above, below}
    const mark = (flags: boolean[], node: ParsedNode) => stages.forEach((s, i) => { if (!flags[i] && lineMatches(node, [s])) flags[i] = true })
    let indent = rows[pos].indent
    for (let j = pos - 1; j >= 0 && indent > 0; j--) {
        if (rows[j].indent >= indent) continue
        indent = rows[j].indent
        mark(above, rows[j].node)
    }
    for (let j = pos + 1; j < rows.length && rows[j].indent > rows[pos].indent; j++) mark(below, rows[j].node)
    return {above, below}
}

type LinkTarget = {node: ParsedNode; depth: number; link: string}

/** linkTargetTree's pages and headings, depth-first, with the link a pick inserts. */
function linkTargets(results: ResultNode[]): LinkTarget[] {
    const out: LinkTarget[] = []
    const walk = (ns: ResultNode[], depth: number) => {
        for (const r of ns) {
            if (out.length >= MAX_LINK_TARGETS) return
            const t = r.node.nodeType
            if (t === "page" || t === "header") out.push({node: r.node, depth, link: reverseMarkdownParsing(r.node)})
            walk(r.children, t === "page" || t === "header" ? depth + 1 : depth)
        }
    }
    walk(results, 0)
    return out
}

const onFirstLine = (text: string, caret: number) => text.lastIndexOf("\n", caret - 1) < 0

/** The line editor for `edit`, keyed by its id (a new LineEdit remounts and focuses it). `rows` are the rendered
 *  outline rows: the edited row's tree context for the red outline. */
export function LineEditor({edit, rows}: {edit: LineEdit; rows: readonly TreeNode[]}) {
    const {outlineAtom, lineEditAtom, updateLineEditAtom, releaseOutlineAtom, outlineFilterStagesAtom} = useMolecule(SearchViewMolecule)
    const {saveOutlineAtom} = useMolecule(EditorMolecule)
    const store = useStore()
    const update = useSetAtom(updateLineEditAtom)
    const release = useSetAtom(releaseOutlineAtom)
    const save = useSetAtom(saveOutlineAtom)
    const app = useAtomValue(GlobalAtoms.appAtom)
    const graph = useAtomValue(GlobalAtoms.graphAtom)
    const index = useAtomValue(GlobalAtoms.indexAtom)
    const outline = useAtomValue(outlineAtom)
    const stages = useAtomValue(outlineFilterStagesAtom)
    const separator = useAtomValue(separatorAtom)
    const archiveTag = useAtomValue(settingsAtom).archiveTag

    const rootRef = useRef<HTMLDivElement>(null)
    const fieldBoxRef = useRef<HTMLDivElement>(null)
    const fieldRef = useRef<MarkdownFieldHandle | null>(null)
    const pending = useRef<TextEdit | null>(null)
    const plainPaste = useRef(false)
    const escapeRef = useRef<() => void>(() => {})
    const scopeKeyRef = useRef<(ev: KeyboardEvent) => boolean>(() => false)
    const [focused, setFocused] = useState(true)

    const row = edit.row
    const dailyPath = useMemo(() => dailyNotePath(dailyConfigOf(index)), [index])
    const target = row === null ? newLineTarget(outline ? rootOf(outline) : null) : null
    /** The file the field's lines are written to (the New line: today's daily note or the line root's file). */
    const linePath = row?.path ?? (target?.kind === "under" ? target.node.location.path : dailyPath)
    /** The note pasted files are named after when the caret has none: the row's, else today's daily note. */
    const notePath = row?.path ?? dailyPath

    const suggest = useLinkSuggest(edit.text, edit.caret, focused)
    const listPrefix = /^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/.exec(edit.text.split("\n")[0])?.[0] ?? ""
    const caretLinePrefix = onFirstLine(edit.text, edit.caret) ? (row?.heading ? edit.prefix : edit.prefix + listPrefix) : ""
    const dateSuggest = useDateSuggest(edit.text, edit.caret, focused, caretLinePrefix)

    const linkResults = useMemo(() => suggest.open ? linkTargetTree(graph, suggest.query, separator) : [], [suggest.open, suggest.query, graph, separator])
    const targets = useMemo(() => linkTargets(linkResults), [linkResults])
    const newName = useMemo(() => suggest.open ? newLinkName(graph, suggest.query, linkResults) : null, [suggest.open, suggest.query, linkResults, graph])
    /** The picked link row: -1 the New note row, else a target. */
    const [pick, setPick] = useState(0)
    useEffect(() => setPick(newName !== null ? -1 : 0), [suggest.open, suggest.query, newName !== null])
    const picked = targets.length === 0 ? -1 : Math.min(pick, targets.length - 1)

    const hints = useMemo(() => lineEditHints(app, edit), [app, edit.text, edit.prefix, edit.row, edit.attachments])
    const blocked = hints.some(h => h.blocking)
    const rowPos = editedRowPos(rows, edit)

    // ── Red outline: field lines the filter would hide (blockMisses) ─────────
    const misses = useMemo(() => {
        if (stages.length === 0) return []
        const raws = fieldRawLines(edit.text, edit.prefix)
        const at: number[] = []
        const lines: {depth: number; node: ParsedNode | null}[] = []
        const nested = row?.nested ?? target?.kind === "under"
        const base = row?.line ?? 0
        raws.forEach((l, i) => {
            if (!l) return
            at.push(i)
            lines.push({depth: l.depth, node: lineNode(l.raw, linePath, base + i, nested || (i > 0 && l.depth > 0), archiveTag)})
        })
        const flags = blockMisses(lines, stages, treeContext(rows, rowPos, stages))
        return at.filter((_, k) => flags[k])
    }, [edit.text, edit.prefix, row, stages, rows, rowPos, linePath, archiveTag])
    const missKey = misses.join()

    /** The flagged lines' boxes in the field box (measured from CodeMirror's line elements, one per doc line). */
    const [missBoxes, setMissBoxes] = useState<{top: number; height: number}[]>([])
    useLayoutEffect(() => {
        const box = fieldBoxRef.current
        if (!box) return
        const frame = requestAnimationFrame(() => {
            const r = box.getBoundingClientRect()
            const lines = box.querySelectorAll(".cm-line")
            const next = misses.flatMap(i => {
                const el = lines[i]
                if (!el) return []
                const b = el.getBoundingClientRect()
                return [{top: b.top - r.top, height: b.height}]
            })
            setMissBoxes(prev => JSON.stringify(prev) === JSON.stringify(next) ? prev : next)
        })
        return () => cancelAnimationFrame(frame)
    }, [edit.text, missKey])

    // ── Escape and the field's keys, claimed through an Obsidian Scope while focus is inside (as InlineEditor) ──
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

    useEffect(() => {
        const scope = new Scope(app.scope)
        scope.register([], "Escape", () => {
            escapeRef.current()
            return false
        })
        scope.register(ANY_MODIFIERS, null, ev => scopeKeyRef.current(ev) ? false : undefined)
        scopeRef.current = scope
        const h = fieldRef.current
        if (h) {
            h.focus()
            h.setSelection(Math.min(edit.caret, h.text().length))
        }
        if (rootRef.current?.contains(document.activeElement)) pushScope()
        return () => {
            popScope()
            scopeRef.current = null
        }
    }, [])

    // A new line (Add to) sits at the end of the view: focus its field and scroll the view down to it, and keep doing
    // so for a moment while the results lay out (they arrive after the editor opens, and the view's own scroll to the
    // selected row would otherwise pull it back up).
    useEffect(() => {
        const root = rootRef.current
        if (edit.row !== null || !root) return
        const toEnd = () => {
            fieldRef.current?.focus()
            root.scrollIntoView({block: "end"})
        }
        const frame = requestAnimationFrame(toEnd)
        const observer = new ResizeObserver(toEnd)
        if (root.parentElement) observer.observe(root.parentElement)
        const stop = window.setTimeout(() => observer.disconnect(), 1000)
        return () => { cancelAnimationFrame(frame); observer.disconnect(); window.clearTimeout(stop) }
    }, [edit.id])

    // Caret and selection requested by text operations.
    useLayoutEffect(() => {
        const p = pending.current
        const h = fieldRef.current
        if (!p || !h) return
        pending.current = null
        h.focus()
        h.setSelection(p.caret, p.selectionEnd ?? p.caret)
    })

    escapeRef.current = () => {
        if (dateSuggest.items.length > 0) return dateSuggest.dismiss()
        if (suggest.open) return suggest.dismiss()
        release("line")
    }

    scopeKeyRef.current = ev => !!rootRef.current?.querySelector(".ts-line-editor-field")?.contains(document.activeElement) && onKeyDown(ev)

    // ── Text plumbing ─────────────────────────────────────────────────────────
    function applyEdit(e: TextEdit) {
        update(s => ({...s, text: e.text, caret: e.caret}))
        pending.current = e
    }

    function fieldState(h: MarkdownFieldHandle) {
        return {text: h.text(), ...h.selection()}
    }

    /** Puts `link` in place of the open `[[query`, else at the caret. */
    function insertLink(link: string) {
        const h = fieldRef.current
        if (!h) return
        const {text, start} = fieldState(h)
        applyEdit(suggest.open ? acceptLink(text, suggest.start, start, link) : insertAtCaret(text, start, link))
    }

    function acceptDate(s: DateSuggestion) {
        const h = fieldRef.current
        if (h) applyEdit(applyDateSuggestion(h.text(), s))
    }

    /** Backspace on an added line (outlineBackspace: an empty one goes); false leaves it to the field. */
    function backspace(): boolean {
        const h = fieldRef.current
        if (!h) return false
        const {text, start, end} = fieldState(h)
        if (start !== end || onFirstLine(text, start)) return false
        const e = outlineBackspace(text, start)
        if (!e) return false
        applyEdit(e)
        return true
    }

    function enter() {
        const h = fieldRef.current
        if (!h) return
        const {text, start, end} = fieldState(h)
        applyEdit(outlineEnter(text.slice(0, start) + text.slice(end), start))
    }

    // ── Keys ──────────────────────────────────────────────────────────────────
    /** True when handled: the field then keeps the key from CodeMirror and Obsidian. */
    function onKeyDown(ev: KeyboardEvent): boolean {
        const mod = Platform.isMacOS ? ev.metaKey : ev.ctrlKey
        plainPaste.current = mod && ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "v"
        if (ev.key === "Escape" || ev.isComposing) return false
        const h = fieldRef.current
        if (!h) return false
        const {text, start, end} = fieldState(h)

        if (dateSuggest.items.length > 0 && !ev.altKey && !mod) {
            if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
                dateSuggest.move(ev.key === "ArrowDown" ? 1 : -1)
                return true
            }
            if ((ev.key === "Enter" || ev.key === "Tab") && !ev.shiftKey) {
                acceptDate(dateSuggest.items[dateSuggest.index])
                return true
            }
        }

        if (suggest.open && (targets.length > 0 || newName !== null) && !ev.altKey && !mod) {
            const first = newName !== null ? -1 : 0
            if (ev.key === "ArrowDown") {
                setPick(Math.min(picked + 1, targets.length - 1))
                return true
            }
            if (ev.key === "ArrowUp") {
                setPick(Math.max(picked - 1, first))
                return true
            }
            if ((ev.key === "Enter" || ev.key === "Tab") && !ev.shiftKey) {
                if (picked === -1 && newName !== null) insertLink(`[[${newName}]]`)
                else if (targets[picked]) insertLink(targets[picked].link)
                return true
            }
        }

        // The New line outline uses Enter to add a child; an edited row saves on Enter.
        if (ev.key === "Enter" && shouldAppendLineOnEnter(edit.row === null ? "append" : "edit", "outline", ev.altKey, mod, ev.shiftKey)) {
            enter()
            return true
        }
        // Alt+Enter adds a line to a row edit; modified Enter saves.
        if (ev.key === "Enter" && ev.altKey && !mod && !ev.shiftKey) {
            enter()
            return true
        }
        if (ev.key === "Enter") {
            void save()
            return true
        }
        if (ev.key === "Backspace" && !ev.altKey && !ev.ctrlKey && !ev.metaKey && backspace()) return true
        if (ev.key === "Tab" && !mod && !ev.altKey) {
            applyEdit(outlineIndent(text, start, ev.shiftKey ? -1 : 1))
            return true
        }
        if (mod && !ev.altKey && !ev.shiftKey) {
            const key = ev.key.toLowerCase()
            if (key === "b" || key === "i") {
                const mark = key === "b" ? "**" : "*"
                applyEdit(wrapSelection(text, start, end, mark, mark))
                return true
            }
            if (key === "k") {
                applyEdit(wrapLink(text, start, end))
                return true
            }
        }
        return false
    }

    // ── Paste ─────────────────────────────────────────────────────────────────
    /** Files become the line editor's attachments, named after the note at the caret (else the row's note, or today's
     *  daily note for the New line); embedded at the caret on the first line, else as child bullets. */
    async function pasteFiles(files: File[], text: string, caret: number) {
        const base = caretNote(text, caret) ?? basenameOf(notePath)
        const id = edit.id
        const taken = [...(store.get(lineEditAtom)?.attachments ?? [])]
        const names: string[] = []
        for (const file of files) {
            const name = attachmentName(base, attachmentKind(file.type), attachmentExt(file.name, file.type), n =>
                !!app.metadataCache.getFirstLinkpathDest(n, "") || taken.some(a => a.name.toLowerCase() === n.toLowerCase()))
            let att
            try {
                att = await pasteAttachment(app, file, name, notePath)
            } catch (err) {
                new Notice(err instanceof Error ? err.message : String(err))
                continue
            }
            if (store.get(lineEditAtom)?.id !== id) {
                // The line editor closed while the file was being written.
                await trashSessionAttachments(app, [att])
                return
            }
            taken.push(att)
            update(s => ({...s, attachments: [...s.attachments, att]}))
            names.push(att.name)
        }
        if (names.length === 0) return
        const h = fieldRef.current
        const current = h ? h.text() : text
        const at = Math.min(caret, current.length)
        applyEdit(onFirstLine(current, at)
            ? insertAtCaret(current, at, names.map(n => `![[${n}]]`).join(" "))
            : insertAttachmentBullets(current, at, names))
    }

    /** Files: attachments; a URL: a markdown link (unless Mod+Shift+V); text: outline lines (pasteOutline, the first
     *  line taken as a bullet line so a pasted list follows it as siblings). */
    function onPaste(ev: ClipboardEvent): boolean {
        const plainOnly = plainPaste.current
        plainPaste.current = false
        const h = fieldRef.current
        if (!h) return false
        const cd = ev.clipboardData
        const files = Array.from(cd?.files ?? [])
        const data = {plain: cd?.getData("text/plain") ?? "", html: cd?.getData("text/html") ?? ""}
        const {text, start, end} = fieldState(h)
        if (files.length > 0) {
            void pasteFiles(files, text, start)
            return true
        }
        const link = plainOnly ? null : linkPasteEdit(text, start, end, data)
        if (link) {
            applyEdit(link)
            return true
        }
        const pasted = (!plainOnly && data.html !== "" && autoConvertHtml(app) ? htmlToMarkdown(data.html) : data.plain).replace(/\r\n?/g, "\n")
        const e = pasteOutline(text, start, end, pasted)
        if (e) applyEdit(e)
        return true
    }

    function onDropFiles(files: File[]) {
        const h = fieldRef.current
        if (h) void pasteFiles(files, h.text(), h.selection().start)
    }

    /** List rows and New lines keep a list marker; heading rows keep their first heading line. */
    const repair = (text: string) => lineEditorRepairs(text, !!row?.heading)

    const indentLevel = (rowPos >= 0 ? rows[rowPos].indent : 0) + 1

    return <div
        className="ts-inline-editor ts-line-editor"
        ref={rootRef}
        style={{"--indent-level": indentLevel} as React.CSSProperties}
        onFocus={pushScope}
        onBlur={ev => {
            if (rootRef.current?.contains(ev.relatedTarget as Node | null)) return
            popScope()
            setFocused(false)
        }}
    >
        <div className="ts-line-editor-row">
            {row?.heading && <span className="ts-line-editor-prefix">{edit.prefix.trim()}</span>}
            <div className="ts-editor-field ts-line-editor-field" ref={fieldBoxRef}>
                <MarkdownField
                    handleRef={fieldRef}
                    className="ts-editor-outline"
                    value={edit.text}
                    app={app}
                    readOnly={edit.saving}
                    sourcePath={notePath}
                    onText={(text, caret) => update(s => ({...s, text, caret}))}
                    onCaret={caret => update(s => s.caret === caret ? s : {...s, caret})}
                    onEnter={() => {
                        // Soft keyboards may not send keydown; mirror the New line / edited-row behavior.
                        if (edit.row === null) enter()
                        else void save()
                        return true
                    }}
                    onBackspace={backspace}
                    repair={repair}
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                    onDropFiles={onDropFiles}
                    onLinkClick={(pos, mod) => {
                        // Mod+click opens the note; a plain click places the caret.
                        const name = mod ? linkAt(edit.text, pos) : null
                        if (name) void openFileByName(app, name)
                        return name !== null
                    }}
                    onFocus={() => setFocused(true)}
                />
                {missBoxes.map((b, i) => <div key={i} className="ts-outline-miss ts-line-miss" style={{top: b.top, height: b.height}}/>)}
                {dateSuggest.items.length > 0 && <SearchAutocomplete
                    suggestions={dateSuggest.items}
                    highlightedIndex={dateSuggest.index}
                    onHover={dateSuggest.setIndex}
                    onAccept={s => acceptDate(s as DateSuggestion)}
                    at={popupAt(fieldRef.current, fieldBoxRef.current, dateSuggest.items[0].start)}
                />}
            </div>
        </div>

        {suggest.open && <div className="ts-line-links">
            {newName !== null && <div className={`ts-link-new${picked === -1 ? " is-selected" : ""}`}
                onMouseDown={ev => ev.preventDefault()} onClick={() => insertLink(`[[${newName}]]`)}>
                <span className="ts-link-new-label">New note</span>
                <span className="ts-link-new-name">[[{newName}]]</span>
            </div>}
            {targets.length === 0
                ? <div className="ts-link-results-empty">{suggest.query.length < 3 ? "Type 3+ characters" : "No matching notes"}</div>
                : targets.map((t, i) => <div key={i} className={`ts-line-link${picked === i ? " is-selected" : ""}`}
                    style={{"--indent-level": t.depth} as React.CSSProperties}
                    onMouseDown={ev => ev.preventDefault()} onClick={() => insertLink(t.link)}>
                    <span className="ts-line-link-name">{t.link}</span>
                    <span className="ts-line-link-path">{t.node.location.path}</span>
                </div>)}
        </div>}

        <div className="ts-editor-footer">
            <div className="ts-editor-hints">
                {hints.map((h, i) => <div key={i} className={`ts-editor-hint ${h.blocking ? "is-blocking" : ""}`}>{h.text}</div>)}
            </div>
            <div className="ts-editor-buttons">
                <button className="ts-editor-button" disabled={edit.saving} onMouseDown={ev => ev.preventDefault()} onClick={() => release("line")}>Cancel</button>
                <button className="ts-editor-button ts-editor-save" disabled={blocked || edit.saving} onMouseDown={ev => ev.preventDefault()} onClick={() => void save()}>Save</button>
            </div>
        </div>
    </div>
}
