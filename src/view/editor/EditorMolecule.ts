// Per-view editor-mode state (EDITOR.md): the inline editor (Append draft / Alt-Edit /
// prose), the Alt-held flag, drag state, and the save / reparent flows. Scoped like
// SearchViewMolecule. The editor is shown in place by the Search modal and pane; requests
// change the draft or session through quick-add-flow.ts.
import {atom, type Getter, type Setter} from "jotai"
import {molecule} from "bunshi"
import {Notice, type App, type TFile} from "obsidian"
import {
    appendContent,
    editorHints,
    getKey,
    HEADER_RE,
    isArchived,
    LIST_ITEM_RE,
    lineHasIdentity,
    localIsoDate,
    NotesGraph,
    OUTLINE_KEY,
    outlineChanged,
    parseOutline,
    planOutlinePatches,
    renameFileHints,
    renderOutline,
    resolveAttachmentEmbeds,
    scheduleUnscheduledTasks,
    splitEditableLine,
    stampAppendedLine,
    stampNewOutlineLines,
    StaleLineError,
    type EditorHint,
    type OutlineLine,
    type ParsedNode,
} from "@mdtree/core"
import {SearchViewMolecule, SearchViewScope} from "../react-context/state"
import {GlobalAtoms} from "../react-context/global"
import {applyEditorRequestAtom, type EditorRequest} from "../react-context/quick-add-flow"
import {renamedFileTarget, rowTargets, type RowTarget} from "../search/select-target"
import {searchFiltersAtom, separatorAtom, settingsAtom, type SearchFilter} from "../react-context/settings"
import type {TreeNode} from "../search/SearchViewFlatten"
import {filterNameHints, normalizeFilterName, renameFilter, renameFilterRefs, saveFilter} from "../search/search-filter"
import {basenameOf, dailyConfigOf, emptySession, fileRenameState, renameFilterState, saveFilterState} from "./draft"
import {
    appendToDailyNote,
    appendUnderLine,
    applyNotePatch,
    applyAttachmentPlan,
    dailyNotePath,
    deleteHeadingSection,
    deleteSubtree,
    editOutlineLines,
    editTaskLine,
    newNotePath,
    readLine,
    renameVaultFile,
    reparent,
    trashSessionAttachments,
    trashVaultFile,
    writeNoteContents,
    writeWholeNote,
    writeNoteBody,
    writeHeadingBody,
    type EditorAttachment,
    type ReparentPlan,
    type TaskChange,
} from "../../editing/vault-edits"
import {archiveLine, archivePage} from "../../obsidian-utils"
import type {DailyNoteConfig} from "../../indexing/indexed-tree"
import {classifyReparent, deleteTargetOf, treeParentPos, type OwnPath} from "./row-editing"
import {
    chainPrefill,
    dirtyBodyKeys,
    isPatchable,
    planReparent,
    type NewPageTarget,
    type RowRef,
} from "../search/chain"
import {fieldLines, newLineTarget, nextLineEditId, rootOf, shiftPins, type LineEdit, type OutlineMode} from "../search/outline"
import {bulkNotice, currentNode, cutCarriers, cutKeyOf, removeCut, type CutFailure} from "../search/cut-drawer"

/** What a prose session writes: a whole existing note (`original` null: a note Save creates). */
export type ProseTarget = {kind: "note"; path: string; original: string | null}

/** What a prose session opens on: a whole note (`noteName` null: today's daily note). `text`: initial text (a
 *  chain's prose paste), appended to an existing note, else the whole buffer. */
export type ProseRequest = {kind: "note"; noteName: string | null; text?: string}

export type EditorState = {
    sessionId: number
    mode: "append" | "edit" | "prose"
    parentName?: string
    /** Append: today's daily note path; Rename of a file: that file. */
    sourcePath: string
    /** Rename of a file: its current name; Rename Filter: the filter's name. */
    originalLine?: string
    /** "file": Rename of an attachment, the outline holds its name without extension; "filter": Save as Filter (or,
     *  with `originalLine`, Rename Filter), the outline holds the filter's name. */
    editKind?: "file" | "filter"
    /** Save as Filter: the query the filter saves (Rename Filter: the filter's query, kept). */
    filterQuery?: string
    outline: string
    contents: Record<string, string>
    contentOrder: string[]
    activeContent: string | null
    attachments: EditorAttachment[]
    doneSteps: string[]
    touchedPaths: string[]
    saving: boolean
    /** Outline caret, kept so a reopened draft and Search picks resume where the user was. */
    caret: number
    /** Prose mode (the whole-note editor Alt+Enter opens): what Save writes. */
    prose?: ProseTarget
    /** Prose mode: a first Save confirmed changes to the note's outline or frontmatter. */
    proseConfirmed?: boolean
}

const OUT_OF_DATE = "This row's index is out of date — try again in a moment"

/** File of the page a node belongs to (headers map to their page), or an attachment's own file; null for references
 *  and other nodes. */
export function makeOwnPath(graph: NotesGraph): OwnPath {
    return (n: ParsedNode) => {
        const key = n.nodeType === "header" ? `[[${n.page.toLowerCase()}]]` : getKey(n)
        if (!graph.hasNode(key)) return null
        const attrs = graph.getNodeAttributes(key)
        if (attrs.nodeType === "attachment") return n.nodeType === "attachment" ? attrs.location.path : null
        return attrs.nodeType === "page" && !attrs.isReference ? attrs.location.path : null
    }
}

/** Footer hints for the editor's current buffers; blocking hints disable Save. */
export function editorHintsFor(app: App, s: EditorState, filters: readonly SearchFilter[]): EditorHint[] {
    if (s.editKind === "filter") return filterNameHints(s.outline, filters, s.originalLine)
    const exists = (name: string) => !!app.metadataCache.getFirstLinkpathDest(name, "")
    if (s.editKind === "file") {
        const name = s.originalLine ?? ""
        const dot = name.lastIndexOf(".")
        return renameFileHints(s.outline, name, dot > 0 ? name.slice(dot + 1) : "", exists)
    }
    const dry = resolveAttachmentEmbeds({[OUTLINE_KEY]: s.outline, ...s.contents}, s.attachments, exists)
    return editorHints({
        mode: s.mode,
        parentName: basenameOf(s.sourcePath),
        outline: s.outline,
        contents: s.contents,
        contentOrder: s.contentOrder,
        noteExists: exists,
        attachmentError: dry.error,
        proseOutlineChanged: proseChangesOutline(s),
        proseConfirmed: s.proseConfirmed,
    })
}

/** Hints under the outline editor's line editor; blocking hints refuse its save. An edited row is checked as a line
 *  edit (a list line or a heading), the New line as an Append outline. */
export function lineEditHints(app: App, edit: LineEdit): EditorHint[] {
    const exists = (name: string) => !!app.metadataCache.getFirstLinkpathDest(name, "")
    const dry = resolveAttachmentEmbeds({[OUTLINE_KEY]: edit.text}, edit.attachments, exists)
    return editorHints({
        mode: edit.row ? "edit" : "append",
        editKind: edit.row?.heading ? "heading" : "list",
        linePrefix: edit.prefix,
        parentName: edit.row ? basenameOf(edit.row.path) : "",
        outline: edit.row ? edit.text : edit.prefix.trimStart() + edit.text,
        contents: {},
        contentOrder: [],
        noteExists: exists,
        attachmentError: dry.error,
    })
}

/** A prose session over an existing note whose buffer changes the note's frontmatter or leading outline. */
function proseChangesOutline(s: EditorState): boolean {
    return s.prose?.kind === "note" && s.prose.original !== null && outlineChanged(s.prose.original, s.outline)
}

const isRowLine = (head: string | null, node: ParsedNode): head is string =>
    head !== null && LIST_ITEM_RE.test(head) && lineHasIdentity(head, node)

/** `node` re-read before a write: a text row whose line still holds it stays as it is (so a duplicate line elsewhere
 *  keeps its own row), else it is looked up again by its key (currentNode). Null when it is gone. */
async function liveNode(app: App, graph: NotesGraph, node: ParsedNode): Promise<ParsedNode | null> {
    if (node.nodeType !== "text") return node
    const {path, position} = node.location
    if (isRowLine(await readLine(app, path, position.start.line), node)) return node
    return currentNode(graph, node)
}

/** The files of `refs`' text rows, read once each; missing files are skipped. */
async function readCutContents(app: App, refs: readonly RowRef[]): Promise<Map<string, string>> {
    const contents = new Map<string, string>()
    for (const {node} of refs) {
        if (node.nodeType !== "text" || contents.has(node.location.path)) continue
        const file = app.vault.getFileByPath(node.location.path)
        if (file) contents.set(node.location.path, await app.vault.read(file))
    }
    return contents
}

/** Save is disabled by any blocking hint. */
export function isSaveBlocked(app: App, s: EditorState, filters: readonly SearchFilter[]): boolean {
    return editorHintsFor(app, s, filters).some(h => h.blocking)
}

/** The Append outline steps of a Save: note patches (`patch:<name>`), then the outline (today's daily note).
 *  Resumable through doneSteps. Returns the first appended line, if any. */
export async function runAppendSteps(
    app: App, cfg: DailyNoteConfig, today: string, cur: () => EditorState, commit: (patch: Partial<EditorState>) => void,
): Promise<{path: string; line: number} | null> {
    const s0 = cur()
    const {lines, patches} = planOutlinePatches(parseOutline(s0.outline).lines, {dropPatchOnlyRoots: true})
    for (const p of patches) {
        const step = `patch:${p.name.toLowerCase()}`
        if (cur().doneSteps.includes(step)) continue
        const file = await applyNotePatch(app, p, cfg)
        commit({touchedPaths: [...cur().touchedPaths, file.path], doneSteps: [...cur().doneSteps, step]})
    }
    if (cur().doneSteps.includes("outline") || lines.length === 0) return null
    const outline = parseOutline(stampNewOutlineLines(renderOutline(lines, 0), today).join("\n")).lines
    const {file, line} = await appendToDailyNote(app, outline, cfg)
    commit({touchedPaths: [...cur().touchedPaths, file.path], doneSteps: [...cur().doneSteps, "outline"]})
    return line === null ? null : {path: file.path, line}
}

/** Rows to select after an Append Save: the appended line, then the parent note. */
export function appendTargets(s: EditorState, appended: {path: string; line: number} | null): RowTarget[] {
    return [
        ...(appended ? [appended] : []),
        ...(s.parentName ? [{key: `[[${s.parentName.toLowerCase()}]]`}] : []),
    ]
}

export const EditorMolecule = molecule((mol, scope) => {
    const scp = scope(SearchViewScope)
    const view = mol(SearchViewMolecule)

    /** The editor's state: the Rename / filter / prose session, if any. */
    const editorStateAtom = atom(
        get => get(GlobalAtoms.editSessionAtom),
        (_get, set, next: EditorState | null) => set(GlobalAtoms.editSessionAtom, next))

    const altHeldAtom = atom(false)
    /** Renderable position of the row being dragged. */
    const dragIndexAtom = atom<number | null>(null)
    const dropTargetAtom = atom<number | null>(null)

    const ownPathAtom = atom(get => {
        get(GlobalAtoms.graphVersionAtom)
        return makeOwnPath(get(GlobalAtoms.graphAtom))
    })

    async function refreshPaths(app: App, index: {refreshPage(f: TFile): Promise<void>} | null, paths: string[]) {
        if (!index) return
        for (const path of [...new Set(paths)]) {
            if (!path.endsWith(".md")) continue
            const file = app.vault.getFileByPath(path)
            if (file) await index.refreshPage(file)
        }
    }

    const markOutOfDate = async (app: App, index: {refreshPage(f: TFile): Promise<void>} | null, path: string) => {
        new Notice(OUT_OF_DATE)
        await refreshPaths(app, index, [path])
    }

    const updateEditorAtom = atom(null, (get, set, fn: (s: EditorState) => EditorState) => {
        const s = get(editorStateAtom)
        if (s) set(editorStateAtom, fn(s))
    })

    /** Closes the editor and trashes its pasted attachments; with `sessionId`, only if that session is still open. */
    const cancelEditorAtom = atom(null, async (get, set, sessionId?: number) => {
        const s = get(editorStateAtom)
        if (!s || (sessionId !== undefined && s.sessionId !== sessionId)) return
        set(editorStateAtom, null)
        await trashSessionAttachments(get(GlobalAtoms.appAtom), s.attachments)
    })

    /** Shows `request` in this view's editor: the Search modal or pane switches to it. */
    const showEditorAtom = atom(null, (_get, set, request: EditorRequest) => {
        set(applyEditorRequestAtom, request)
        set(view.enterEditorAtom)
    })

    /** Closes the editor, back to the view's search (`saved`: the written rows to select). */
    const closeEditorAtom = atom(null, (_get, set, exit: {kind: "saved"; targets: RowTarget[]} | {kind: "cancelled"}) => {
        set(view.leaveEditorAtom, {saved: exit.kind === "saved" ? exit.targets : null, focus: true})
    })

    /** Opens the outline editor's line editor on `row`: a line, a link line (`- [[Note]]`) or a heading. A note's own
     *  row (no line of its own) shows its content pane instead; an attachment opens its Rename. The line must still
     *  hold the row (else the out-of-date Notice); a changed line editor refuses it once. */
    const editRowAtom = atom(null, async (get, set, row: TreeNode) => {
        if (row.archiveRow) return
        const node = row.node
        if (node.nodeType === "attachment") {
            set(showEditorAtom, {kind: "session", state: fileRenameState(node.location.path, node.name)})
            return
        }
        if (!isPatchable(node)) return
        if (node.nodeType === "page" && get(ownPathAtom)(node) === node.location.path) {
            set(view.openRowPaneAtom, node)
            return
        }
        if (get(view.lineEditAtom) && !set(view.releaseOutlineAtom, "line")) return
        const app = get(GlobalAtoms.appAtom)
        const path = node.location.path
        const line = node.location.position.start.line
        const text = await readLine(app, path, line)
        const isList = text !== null && LIST_ITEM_RE.test(text)
        const split = text !== null && (isList || HEADER_RE.test(text)) && lineHasIdentity(text, node)
            ? splitEditableLine(text)
            : null
        if (text === null || !split) {
            await markOutOfDate(app, get(GlobalAtoms.indexAtom), path)
            return
        }
        set(view.lineEditAtom, {
            id: nextLineEditId(),
            row: {node, path, line, expectedLine: text, heading: !isList, nested: node.nodeType === "text" && node.nested === true},
            prefix: split.prefix,
            text: split.text,
            initial: split.text,
            caret: split.text.length,
            attachments: [],
            saving: false,
        })
    })

    /** Alt+Enter, Alt+click, the panel's Edit, Enter on a plain line (rowIntent): the line editor on `row` (default:
     *  in the outline editor the row Enter acts on, elsewhere the selected row), in place. Outside the outline editor
     *  it first opens the outline on the search (in `mode`), which lists the same rows; with nothing selected that
     *  is all it does. An attachment opens its Rename. */
    const editAtom = atom(null, async (get, set, row?: TreeNode, mode: OutlineMode = "edit") => {
        const inOutline = get(view.outlineAtom) !== null
        const target = row ?? (inOutline ? get(view.enterRowAtom) : get(view.selectedNodeAtom))
        if (target?.archiveRow) return
        if (target && !isPatchable(target.node) && target.node.nodeType !== "attachment") return
        if (!inOutline && target?.node.nodeType !== "attachment" && !set(view.openOutlineAtom, {kind: "search", mode})) return
        if (target) await set(editRowAtom, target)
    })

    /** Rename of the file at `path` (a note or an embedded file); Save renames it through Obsidian, which updates links. */
    const openRenameFileAtom = atom(null, (get, set, path: string) => {
        const file = get(GlobalAtoms.appAtom).vault.getFileByPath(path)
        if (!file) {
            new Notice(`${path} no longer exists`)
            return
        }
        set(showEditorAtom, {kind: "session", state: fileRenameState(file.path, file.name)})
    })

    /** Save as Filter for `query`: the editor asks for the filter's name. */
    const openSaveFilterAtom = atom(null, (_get, set, query: string) => set(showEditorAtom, {kind: "session", state: saveFilterState(query)}))
    /** Rename Filter: the editor asks for the filter's new name. */
    const openRenameFilterAtom = atom(null, (_get, set, filter: SearchFilter) => set(showEditorAtom, {kind: "session", state: renameFilterState(filter)}))

    const selectedPos = (get: Getter): {rows: TreeNode[]; pos: number} => {
        const rows = get(view.renderableTreeNodesAtom)
        const selected = get(view.selectedLineAtom)
        return {rows, pos: rows.findIndex(r => r.index === selected)}
    }

    /** `>` in the search input: the outline editor on the selected row (inside it: descends into the row); with
     *  nothing selected, Today with the New line pre-filled from the search (chainPrefill). */
    const patchAtom = atom(null, (get, set) => {
        const sel = get(view.selectedNodeAtom)
        if (sel && !sel.archiveRow) {
            if (!isPatchable(sel.node)) new Notice("Can't add under this row")
            else set(view.openOutlineAtom, {kind: "row", row: sel, mode: "edit"})
            return
        }
        set(view.openOutlineAtom, {kind: "today", prefill: chainPrefill(get(view.searchTextAtom), get(separatorAtom), get(settingsAtom).archiveTag)})
    })

    /** Outline lines with the dates an Append save gives new lines (stampNewOutlineLines). */
    const stampLines = (lines: OutlineLine[], today: string): OutlineLine[] =>
        lines.map(l => ({...l, text: stampNewOutlineLines([l.marker + l.text], today)[0].slice(l.marker.length)}))
    const lineRange = (at: number, count: number) => Array.from({length: count}, (_, i) => at + i)

    let savingOutline = false
    /** Mod+Enter in the outline editor, and the line editor's and content pane's Save: writes every changed content
     *  buffer (their pasted files renamed by alias), then the line editor. An edited row's line is rewritten with the
     *  added lines (editOutlineLines); the New line is written under the root (newLineTarget). The written lines are
     *  pinned, the files reindexed and the row flashes. An unchanged line editor just closes. */
    const saveOutlineAtom = atom(null, async (get, set) => {
        if (savingOutline) return
        const edit = get(view.lineEditAtom)
        const dirty = dirtyBodyKeys(get(view.outlineBodiesAtom))
        const writesLine = edit !== null && (edit.row ? edit.text !== edit.initial : edit.text.trim() !== "")
        if (!writesLine && dirty.length === 0) {
            if (edit) set(view.releaseOutlineAtom, "line")
            return
        }
        const app = get(GlobalAtoms.appAtom)
        if (edit !== null && writesLine && lineEditHints(app, edit).some(h => h.blocking)) return
        const index = get(GlobalAtoms.indexAtom)
        const cfg = dailyConfigOf(index)
        const today = localIsoDate(new Date())
        const exists = (name: string) => !!app.metadataCache.getFirstLinkpathDest(name, "")
        const touched: string[] = []
        savingOutline = true
        try {
            if (dirty.length > 0) {
                const bodies = get(view.outlineBodiesAtom)
                let texts: Record<string, string> = Object.fromEntries(dirty.map(k => [k, bodies[k].text]))
                const attachments = get(view.bodyAttachmentsAtom)
                if (attachments.length > 0) {
                    const plan = resolveAttachmentEmbeds(texts, attachments, exists)
                    if (plan.error) throw new Error("Attachment embeds changed — check the content and save again")
                    await applyAttachmentPlan(app, attachments, plan)
                    set(view.bodyAttachmentsAtom, [])
                    texts = plan.buffers
                }
                for (const key of dirty) {
                    const b = bodies[key]
                    const saved = texts[key]
                    const file = b.heading === null
                        ? await writeNoteBody(app, b.path, b.original, saved)
                        : await writeHeadingBody(app, b.path, b.heading, b.original, saved)
                    touched.push(file.path)
                    const now = get(view.outlineBodiesAtom)
                    if (now[key]) set(view.outlineBodiesAtom, {...now, [key]: {...now[key], original: saved, text: now[key].text === b.text ? saved : now[key].text}})
                }
                set(view.discardArmedAtom, false)
            }
            if (edit === null || !writesLine) return
            set(view.lineEditAtom, {...edit, saving: true})
            let text = edit.text
            if (edit.attachments.length > 0) {
                const plan = resolveAttachmentEmbeds({[OUTLINE_KEY]: text}, edit.attachments, exists)
                if (plan.error) throw new Error("Attachment embeds changed — check the hints and save again")
                const attachments = await applyAttachmentPlan(app, edit.attachments, plan)
                text = plan.buffers[OUTLINE_KEY]
                const cur = get(view.lineEditAtom)
                if (cur?.id === edit.id) set(view.lineEditAtom, {...cur, text, attachments})
            }
            const o = get(view.outlineAtom)
            let pins = o?.pins ?? []
            let targets: RowTarget[]
            if (edit.row) {
                const r = edit.row
                const {first, extra} = fieldLines(text)
                const line = edit.prefix + first
                const {file, inserted} = await editOutlineLines(app, r.path, r.line, r.expectedLine,
                    r.heading || r.nested ? line : scheduleUnscheduledTasks(line, today), stampLines(extra, today))
                touched.push(file.path)
                pins = shiftPins(pins, r.path, inserted, [r.line, ...inserted.flatMap(b => lineRange(b.at, b.count))])
                targets = [{path: r.path, line: r.line}]
            } else {
                const lines = parseOutline(edit.prefix.trimStart() + text).lines
                const target = newLineTarget(o ? rootOf(o) : null)
                if (target.kind === "under") {
                    const node = target.node
                    const path = node.location.path
                    const at = node.location.position.start.line
                    const head = await readLine(app, path, at)
                    if (!isRowLine(head, node)) throw new StaleLineError()
                    const r = await appendUnderLine(app, path, at, head, renderOutline(lines, 0).map(l => stampAppendedLine(l, today)))
                    touched.push(path)
                    pins = shiftPins(pins, path, [{at: r.line, count: lines.length}], lineRange(r.line, lines.length))
                    targets = [{path, line: r.line}]
                } else {
                    const outline = target.parentName ? [`- [[${target.parentName}]]`, ...renderOutline(lines, 1)] : renderOutline(lines, 0)
                    let s: EditorState = {...emptySession(), mode: "append", sourcePath: dailyNotePath(cfg), parentName: target.parentName, outline: outline.join("\n"), caret: 0}
                    const appended = await runAppendSteps(app, cfg, today, () => s, p => { s = {...s, ...p} })
                    touched.push(...s.touchedPaths)
                    if (appended) pins = shiftPins(pins, appended.path, [{at: appended.line, count: lines.length}], lineRange(appended.line, lines.length))
                    targets = appendTargets(s, appended)
                }
            }
            set(view.lineEditAtom, null)
            const now = get(view.outlineAtom)
            if (now) set(view.outlineAtom, {...now, pins})
            set(GlobalAtoms.pendingSelectAtom, {view: scp.name, targets, flash: true})
        } catch (err) {
            if (err instanceof StaleLineError) new Notice(OUT_OF_DATE)
            else new Notice(`${err instanceof Error ? err.message : String(err)}\nWritten: ${touched.join(", ") || "nothing"}`)
            const cur = get(view.lineEditAtom)
            if (cur?.saving) set(view.lineEditAtom, {...cur, saving: false})
        } finally {
            savingOutline = false
            await refreshPaths(app, index, touched)
        }
    })

    const saveEditorAtom = atom(null, async (get, set) => {
        const start = get(editorStateAtom)
        if (!start || start.saving) return
        const app = get(GlobalAtoms.appAtom)
        const index = get(GlobalAtoms.indexAtom)
        if (isSaveBlocked(app, start, get(searchFiltersAtom))) return
        // Save as Filter: adds the named pill, or replaces the one with that name. Rename Filter: renames the pill and
        // every `:Name` reference to it, in the filters and in the query this view returns to. Both go back to the
        // search with its selection (nothing written to flash).
        if (start.editKind === "filter") {
            const from = start.originalLine
            const to = normalizeFilterName(start.outline)
            set(searchFiltersAtom, from !== undefined
                ? renameFilter(get(searchFiltersAtom), from, to)
                : saveFilter(get(searchFiltersAtom), start.outline, start.filterQuery ?? ""))
            set(editorStateAtom, null)
            set(closeEditorAtom, {kind: "cancelled"})
            if (from !== undefined) {
                const q = get(view.actualQueryAtom)
                const renamed = renameFilterRefs(q, from, to)
                if (renamed !== q) setViewQuery(set, renamed)
            }
            return
        }
        // Prose that rewrites the note's outline or frontmatter needs a second Save.
        if (!start.proseConfirmed && proseChangesOutline(start)) {
            set(editorStateAtom, {...start, proseConfirmed: true})
            return
        }

        let s: EditorState = {...start, saving: true}
        const commit = (patch: Partial<EditorState>) => {
            s = {...s, ...patch}
            if (get(editorStateAtom)?.sessionId === s.sessionId) set(editorStateAtom, s)
        }
        commit({})

        const cfg = dailyConfigOf(index)
        const exists = (name: string) => !!app.metadataCache.getFirstLinkpathDest(name, "")
        try {
            if (!s.doneSteps.includes("attachments")) {
                const plan = resolveAttachmentEmbeds({[OUTLINE_KEY]: s.outline, ...s.contents}, s.attachments, exists)
                if (plan.error) throw new Error("Attachment embeds changed — check the hints and save again")
                const attachments = await applyAttachmentPlan(app, s.attachments, plan)
                const {[OUTLINE_KEY]: outline, ...contents} = plan.buffers
                commit({attachments, outline, contents, doneSteps: [...s.doneSteps, "attachments"]})
            }

            for (const name of s.contentOrder) {
                const step = `content:${name}`
                const buffer = s.contents[name] ?? ""
                if (s.doneSteps.includes(step) || !buffer.trim()) continue
                const file = await writeNoteContents(app, name, buffer, dailyNotePath(cfg))
                commit({touchedPaths: [...s.touchedPaths, file.path], doneSteps: [...s.doneSteps, step]})
            }

            if (s.mode === "edit" && s.editKind === "file" && !s.doneSteps.includes("rename")) {
                const path = await renameVaultFile(app, s.sourcePath, s.outline)
                commit({touchedPaths: [...s.touchedPaths, path], doneSteps: [...s.doneSteps, "rename"]})
            }
            if (s.prose?.kind === "note" && !s.doneSteps.includes("prose")) {
                const file = await writeWholeNote(app, s.prose.path, s.prose.original, s.outline)
                commit({touchedPaths: [...s.touchedPaths, file.path], doneSteps: [...s.doneSteps, "prose"]})
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            new Notice(`${message}\nWritten: ${s.touchedPaths.join(", ") || "nothing"}`)
            commit({saving: false})
            return
        }

        if (get(editorStateAtom)?.sessionId !== s.sessionId) {
            await refreshPaths(app, index, s.touchedPaths)
            return
        }
        // Saved: back to the search, which selects and flashes the written row.
        set(editorStateAtom, null)
        const targets: RowTarget[] = s.prose?.kind === "note" ? [{key: `[[${basenameOf(s.prose.path).toLowerCase()}]]`}]
            : [renamedFileTarget(s.touchedPaths[s.touchedPaths.length - 1])]
        // A renamed path isn't reindexed by refreshPage (the index has no rename handler): rebuild it.
        if (s.editKind === "file") await index?.refresh()
        else await refreshPaths(app, index, s.touchedPaths)
        set(closeEditorAtom, {kind: "saved", targets})
    })

    const clearDragAtom = atom(null, (_get, set) => {
        set(dragIndexAtom, null)
        set(dropTargetAtom, null)
    })

    const reparentAtom = atom(null, async (get, _set, dragPos: number, targetPos: number) => {
        const app = get(GlobalAtoms.appAtom)
        const index = get(GlobalAtoms.indexAtom)
        const rows = get(view.renderableTreeNodesAtom)
        const dragged = rows[dragPos]
        const source = dragged.node.location.path
        try {
            let plan = classifyReparent(rows, dragPos, targetPos, get(ownPathAtom), get(settingsAtom).parentRelation)
            if (plan.kind !== "frontmatter") {
                const head = await readLine(app, plan.sourcePath, plan.line)
                if (head === null || !LIST_ITEM_RE.test(head) || !lineHasIdentity(head, dragged.node)) {
                    await markOutOfDate(app, index, source)
                    return
                }
                plan = plan.kind === "cross-file" ? {...plan, head, stampDate: index?.lineDateOf(plan.sourcePath) ?? null} : {...plan, head}
            }
            const touched = await reparent(app, plan)
            await refreshPaths(app, index, touched.map(f => f.path))
        } catch (err) {
            if (err instanceof StaleLineError) await markOutOfDate(app, index, source)
            else new Notice(err instanceof Error ? err.message : String(err))
        }
    })

    const setViewQuery = (set: Setter, query: string) => {
        set(view.searchQueryAtom, {query})
        set(GlobalAtoms.lastSearchAtom, {query})
    }

    /** Opens the prose editor on a whole note (`noteName` null: today's daily note). */
    const openProseAtom = atom(null, async (get, set, request: ProseRequest) => {
        const app = get(GlobalAtoms.appAtom)
        const index = get(GlobalAtoms.indexAtom)
        const dailyPath = dailyNotePath(dailyConfigOf(index))
        const {noteName} = request
        const file = noteName === null ? app.vault.getFileByPath(dailyPath) : app.metadataCache.getFirstLinkpathDest(noteName, "")
        const path = file?.path ?? (noteName === null ? dailyPath : newNotePath(app, noteName, dailyPath))
        const original = file ? await app.vault.read(file) : null
        const outline = original === null ? request.text ?? "" : request.text ? appendContent(original, request.text) : original
        set(showEditorAtom, {kind: "session", state: {
            ...emptySession(),
            mode: "prose",
            sourcePath: path,
            outline,
            caret: outline.length,
            prose: {kind: "note", path, original},
            proseConfirmed: false,
        }})
    })

    /** Enter in reparent mode: moves the chain's rows (one row, or the cut drawer's) under `target` (a result row, or a
     *  typed new page name), one after the other in drawer order; a row inside another moved row goes with it. Moved
     *  rows leave the drawer; when none moved the chain stays open for another target. */
    const reparentChainAtom = atom(null, async (get, set, target: ParsedNode | NewPageTarget) => {
        const chain = get(view.chainAtom)
        if (chain?.mode !== "reparent") return
        const app = get(GlobalAtoms.appAtom)
        const index = get(GlobalAtoms.indexAtom)
        const cfg = dailyConfigOf(index)
        const relation = get(settingsAtom).parentRelation
        const graph = () => get(GlobalAtoms.graphAtom)
        const failures: CutFailure[] = []
        const reasons = new Map<string, string>()
        const fail = (ref: RowRef, reason: string) => {
            failures.push({label: ref.label, reason})
            reasons.set(cutKeyOf(ref.node), reason)
        }
        // The last move's reindex runs before the next row is re-read, and for the last row after the view updates.
        let pendingRefresh: (() => Promise<void>) | null = null
        const settle = async () => {
            const refresh = pendingRefresh
            pendingRefresh = null
            await refresh?.()
        }

        /** Moves one row under `to`; the failure reason, or null. */
        const moveOne = async (child: RowRef, to: ParsedNode | NewPageTarget): Promise<string | null> => {
            const source = child.node.location.path
            try {
                const planned = planReparent(child, to, {ownPath: get(ownPathAtom), relation, cfg})
                if ("error" in planned) return planned.error
                let plan: ReparentPlan = planned
                if (plan.kind === "to-daily" || plan.kind === "under-line") {
                    const head = await readLine(app, plan.sourcePath, plan.line)
                    if (!isRowLine(head, child.node)) {
                        await refreshPaths(app, index, [source])
                        return OUT_OF_DATE
                    }
                    const destPath = plan.kind === "to-daily" ? dailyNotePath(cfg) : plan.targetPath
                    const stampDate = destPath !== plan.sourcePath ? index?.lineDateOf(plan.sourcePath) ?? null : null
                    if (plan.kind === "under-line") {
                        const targetHead = await readLine(app, plan.targetPath, plan.targetLine)
                        if (to.nodeType !== "text" || !isRowLine(targetHead, to)) {
                            await refreshPaths(app, index, [plan.targetPath])
                            return OUT_OF_DATE
                        }
                        plan = {...plan, head, targetHead, stampDate}
                    } else {
                        plan = {...plan, head, stampDate}
                    }
                }
                const touched = await reparent(app, plan)
                // Renamed paths aren't reindexed by refreshPage (the index has no rename handler): rebuild it.
                pendingRefresh = plan.kind === "to-folder"
                    ? async () => { await index?.refresh() }
                    : () => refreshPaths(app, index, touched.map(f => f.path))
                return null
            } catch (err) {
                if (err instanceof StaleLineError) {
                    await refreshPaths(app, index, [source])
                    return OUT_OF_DATE
                }
                return err instanceof Error ? err.message : String(err)
            }
        }

        const refs: RowRef[] = []
        for (const c of chain.children) {
            const node = await liveNode(app, graph(), c.node)
            if (node) refs.push({...c, node})
            else fail(c, OUT_OF_DATE)
        }
        const carriers = cutCarriers(refs, await readCutContents(app, refs),
            n => n.nodeType === "folder" ? n.path : get(ownPathAtom)(n))
        const moved: RowRef[] = []
        let to = target
        for (const ref of refs) {
            if (carriers.has(cutKeyOf(ref.node))) continue
            await settle()
            // Earlier moves may have shifted this row's line or the target's.
            const node = await liveNode(app, graph(), ref.node)
            const toNode = to.nodeType === "text" ? await liveNode(app, graph(), to) : to
            if (!node || !toNode) {
                fail(ref, OUT_OF_DATE)
                continue
            }
            to = toNode
            const child = {...ref, node}
            const reason = await moveOne(child, to)
            if (reason === null) moved.push(child)
            else fail(ref, reason)
        }
        // A carried row moved with its carrier, or stayed with it.
        const movedKeys = new Set(moved.map(r => cutKeyOf(r.node)))
        for (const ref of refs) {
            const carrier = carriers.get(cutKeyOf(ref.node))
            if (carrier === undefined) continue
            if (movedKeys.has(carrier)) moved.push(ref)
            else fail(ref, reasons.get(carrier) ?? OUT_OF_DATE)
        }
        if (moved.length > 0) {
            set(view.chainAtom, null)
            setViewQuery(set, chain.prevQuery)
            set(GlobalAtoms.pendingSelectAtom, {view: scp.name, targets: moved.map(c => ({key: getKey(c.node)})), flash: true})
            set(GlobalAtoms.cutDrawerAtom, removeCut(get(GlobalAtoms.cutDrawerAtom), moved))
        }
        const msg = bulkNotice("Moved", moved.length, chain.children.length, failures)
        if (msg) new Notice(msg)
        await settle()
    })

    /** The drawer's Archive: archives every cut line and page in drawer order; a line inside another cut line goes
     *  with it. Archived items leave the drawer; folders and attachments can't be archived and stay. */
    const archiveDrawerAtom = atom(null, async (get, set) => {
        const items = get(GlobalAtoms.cutDrawerAtom)
        if (items.length === 0) return
        const app = get(GlobalAtoms.appAtom)
        const index = get(GlobalAtoms.indexAtom)
        const failures: CutFailure[] = []
        const reasons = new Map<string, string>()
        const fail = (ref: RowRef, reason: string) => {
            failures.push({label: ref.label, reason})
            reasons.set(cutKeyOf(ref.node), reason)
        }
        const refs: RowRef[] = []
        for (const c of items) {
            const node = await liveNode(app, get(GlobalAtoms.graphAtom), c.node)
            if (node) refs.push({...c, node})
            else fail(c, OUT_OF_DATE)
        }
        // Only lines carry here: a folder isn't archived, so it can't cover what's inside it.
        const carriers = cutCarriers(refs.filter(r => r.node.nodeType === "text"), await readCutContents(app, refs), () => null)
        const archived: RowRef[] = []
        const touched: string[] = []
        for (const ref of refs) {
            const node = ref.node
            if (carriers.has(cutKeyOf(node))) continue
            try {
                if (node.nodeType === "text") {
                    // Archiving appends to a line, so other lines keep their place.
                    const path = node.location.path
                    if (!isRowLine(await readLine(app, path, node.location.position.start.line), node)) {
                        await refreshPaths(app, index, [path])
                        fail(ref, OUT_OF_DATE)
                        continue
                    }
                    if (!isArchived(node)) {
                        await archiveLine(app, node.location, get(settingsAtom).archiveTag)
                        touched.push(path)
                    }
                } else if (node.nodeType === "page") {
                    const path = get(ownPathAtom)(node)
                    if (path === null) {
                        fail(ref, `[[${node.page}]] has no note to archive`)
                        continue
                    }
                    await archivePage(app, path, get(settingsAtom).archiveTag)
                    touched.push(path)
                } else {
                    fail(ref, "Folders and attachments can't be archived")
                    continue
                }
                archived.push(ref)
            } catch (err) {
                fail(ref, err instanceof Error ? err.message : String(err))
            }
        }
        const archivedKeys = new Set(archived.map(r => cutKeyOf(r.node)))
        for (const ref of refs) {
            const carrier = carriers.get(cutKeyOf(ref.node))
            if (carrier === undefined) continue
            if (archivedKeys.has(carrier)) archived.push(ref)
            else fail(ref, reasons.get(carrier) ?? OUT_OF_DATE)
        }
        // Reindexed here: the shared modify debounce can drop reindexes of several files.
        await refreshPaths(app, index, touched)
        set(GlobalAtoms.cutDrawerAtom, removeCut(get(GlobalAtoms.cutDrawerAtom), archived))
        const msg = bulkNotice("Archived", archived.length, items.length, failures)
        if (msg) new Notice(msg)
    })

    /** Checkbox / Task panel action on a task row: rewrites its line, then reindexes, keeping `anchor` (the row
     *  showing the task; the task itself unless it is a line of a timeline block) selected. */
    const editTaskAtom = atom(null, async (get, set, node: ParsedNode, change: TaskChange, anchor: ParsedNode = node) => {
        if (node.nodeType !== "text" || !node.isTask) return
        const app = get(GlobalAtoms.appAtom)
        const index = get(GlobalAtoms.indexAtom)
        const path = node.location.path
        try {
            const touched = await editTaskLine(app, node, change)
            set(GlobalAtoms.pendingSelectAtom, {
                view: scp.name,
                targets: [{path: anchor.location.path, line: anchor.location.position.start.line}],
                flash: false,
            })
            await refreshPaths(app, index, touched.map(f => f.path))
        } catch (err) {
            if (err instanceof StaleLineError) await markOutOfDate(app, index, path)
            else new Notice(err instanceof Error ? err.message : String(err))
        }
    })

    /** The panel's Delete (after its confirmation): a list line with its nested lines, a heading with its section, or a
     *  file to the trash (`deleteTargetOf`). Tree mode selects the row's parent afterwards. */
    const deleteRowAtom = atom(null, async (get, set, row: TreeNode) => {
        const timeline = get(view.timelineActiveAtom)
        const target = deleteTargetOf(row, get(ownPathAtom), timeline)
        if (!target) return
        const app = get(GlobalAtoms.appAtom)
        const index = get(GlobalAtoms.indexAtom)
        const rows = get(view.renderableTreeNodesAtom)
        const pos = timeline ? -1 : rows.findIndex(r => r.index === row.index)
        const parentPos = pos >= 0 ? treeParentPos(rows, pos) : null
        const selectParent = () => {
            if (parentPos !== null) set(GlobalAtoms.pendingSelectAtom, {view: scp.name, targets: rowTargets(rows[parentPos]), flash: false})
        }
        try {
            if (target.kind === "file") {
                await trashVaultFile(app, target.path)
                selectParent()
                // The index has no delete handler: rebuild it.
                await index?.refresh()
                return
            }
            const head = await readLine(app, target.path, target.line)
            const valid = target.kind === "line"
                ? isRowLine(head, row.node)
                : head !== null && HEADER_RE.test(head) && lineHasIdentity(head, row.node)
            if (!valid || head === null) {
                await markOutOfDate(app, index, target.path)
                return
            }
            const touched = target.kind === "line"
                ? await deleteSubtree(app, target.path, target.line, head)
                : await deleteHeadingSection(app, target.path, target.line, head)
            selectParent()
            await refreshPaths(app, index, touched.map(f => f.path))
        } catch (err) {
            if (err instanceof StaleLineError) await markOutOfDate(app, index, target.path)
            else new Notice(err instanceof Error ? err.message : String(err))
        }
    })

    return {
        editorStateAtom, altHeldAtom, dragIndexAtom, dropTargetAtom, ownPathAtom,
        updateEditorAtom, cancelEditorAtom, closeEditorAtom, openRenameFileAtom, openSaveFilterAtom, openRenameFilterAtom,
        saveEditorAtom,
        clearDragAtom, reparentAtom, editTaskAtom, deleteRowAtom,
        reparentChainAtom, archiveDrawerAtom, openProseAtom,
        editRowAtom, editAtom, patchAtom, saveOutlineAtom,
    }
})
