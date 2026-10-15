// Per-view editor-mode state (EDITOR.md): the inline editor (Append draft / Alt-Edit /
// prose), the Alt-held flag, drag state, and the save / reparent flows. Scoped like
// SearchViewMolecule. The editor is shown in place by the Search modal and pane; requests
// change the draft or session through quick-add-flow.ts.
import {atom, type Getter, type Setter} from "jotai"
import {molecule} from "bunshi"
import {Notice, type App, type TFile} from "obsidian"
import {
    appendContent,
    appendOutlineEmpty,
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
    type ParsedNode,
} from "@mdtree/core"
import {SearchViewMolecule, SearchViewScope} from "../react-context/state"
import {GlobalAtoms} from "../react-context/global"
import {applyEditorRequestAtom, type EditorRequest} from "../react-context/quick-add-flow"
import {renamedFileTarget, rowTargets, type RowTarget} from "../search/select-target"
import {appendDraftAtom, searchFiltersAtom, separatorAtom, settingsAtom, type SearchFilter} from "../react-context/settings"
import type {TreeNode} from "../search/SearchViewFlatten"
import {filterNameHints, normalizeFilterName, renameFilter, renameFilterRefs, saveFilter} from "../search/search-filter"
import {basenameOf, dailyConfigOf, emptySession, fileRenameState, proseNameFrom, renameFilterState, saveFilterState} from "./draft"
import type {PasteData} from "./textarea-ops"
import {
    appendToDailyNote,
    appendUnderLine,
    applyNotePatch,
    applyAttachmentPlan,
    dailyNotePath,
    deleteHeadingSection,
    deleteSubtree,
    editLine,
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
    type EditorAttachment,
    type ReparentPlan,
    type TaskChange,
} from "../../editing/vault-edits"
import {archiveLine, archivePage} from "../../obsidian-utils"
import type {DailyNoteConfig} from "../../indexing/indexed-tree"
import {appendTargetAt, classifyReparent, deleteTargetOf, isEditableRow, treeParentPos, type OwnPath} from "./row-editing"
import {
    chainEditorText,
    chainOutline,
    chainPrefill,
    chainPrevQuery,
    dirtyBodyPaths,
    isEntryInput,
    isPatchable,
    parseChainEntry,
    planReparent,
    rowLabel,
    type ChainAnchor,
    type ChainStep,
    type NewPageTarget,
    type RowRef,
} from "../search/chain"
import {bulkNotice, currentNode, cutCarriers, cutKeyOf, removeCut, type CutFailure} from "../search/cut-drawer"
import {appendPickFor, type AppendPick} from "./append-target"

/** What a prose session writes: a whole existing note (`original` null: a note Save creates), or a new note whose
 *  link Save appends to the line it was started from. */
export type ProseTarget =
    | {kind: "note"; path: string; original: string | null}
    | {kind: "new"; name: string; link: {path: string; line: number; expectedLine: string}}

/** What a prose session opens on: a whole note (`noteName` null: today's daily note), or a new note to link from
 *  `line` (an Append target's picked line). `text`: initial text (a chain's prose paste), appended to an existing
 *  note, else the whole buffer. */
export type ProseRequest = {kind: "note"; noteName: string | null; text?: string} | {kind: "line"; line: UnderLine; text?: string}

/** Append target below a picked line (Search's `>` on a text row): Save writes the outline as that line's last
 *  children in its own file, every line stamped. */
export type UnderLine = {path: string; line: number; expectedLine: string; label: string}

export type EditorState = {
    sessionId: number
    mode: "append" | "edit" | "prose"
    parentName?: string
    /** Append: today's daily note path; Edit: the row's file (Rename of a file: that file). */
    sourcePath: string
    line?: number
    /** Edit: the line as read from the file; Rename of a file: its current name; Rename Filter: the filter's name. */
    originalLine?: string
    linePrefix?: string
    /** Edit: a list line or a heading (Rename); "file": Rename of an attachment, the outline holds its name without extension;
     *  "filter": Save as Filter (or, with `originalLine`, Rename Filter), the outline holds the filter's name. */
    editKind?: "list" | "heading" | "file" | "filter"
    /** Save as Filter: the query the filter saves (Rename Filter: the filter's query, kept). */
    filterQuery?: string
    /** Alt-Edit of a nested line (TextNode.nested): no default schedule. */
    nested?: boolean
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
    /** Append under a picked line instead of today's daily note. */
    underLine?: UnderLine
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
        editKind: s.editKind,
        linePrefix: s.linePrefix,
        parentName: s.mode === "append" ? s.parentName ?? "" : basenameOf(s.sourcePath),
        outline: s.outline,
        contents: s.contents,
        contentOrder: s.contentOrder,
        noteExists: exists,
        attachmentError: dry.error,
        proseNewName: s.prose?.kind === "new" ? s.prose.name : undefined,
        proseOutlineChanged: proseChangesOutline(s),
        proseConfirmed: s.proseConfirmed,
        patches: s.mode === "append" ? planOutlinePatches(parseOutline(s.outline).lines, {dropPatchOnlyRoots: !s.underLine}).patches : undefined,
    })
}

/** A prose session over an existing note whose buffer changes the note's frontmatter or leading outline. */
function proseChangesOutline(s: EditorState): boolean {
    return s.prose?.kind === "note" && s.prose.original !== null && outlineChanged(s.prose.original, s.outline)
}

/** `line` with ` [[name]]` added before a trailing ` ^blockid`, else at the end. */
export function withTrailingLink(line: string, name: string): string {
    const m = line.match(/^(.*?)(\s+\^[\w-]+)?\s*$/)!
    return `${m[1]} [[${name}]]${m[2] ?? ""}`
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

/** Save is disabled by any blocking hint, or by an Append outline that adds nothing. */
export function isSaveBlocked(app: App, s: EditorState, filters: readonly SearchFilter[]): boolean {
    return editorHintsFor(app, s, filters).some(h => h.blocking) || (s.mode === "append" && appendOutlineEmpty(s.outline, s.parentName))
}

/** The Append outline steps of a Save: note patches (`patch:<name>`), then the outline (daily note, or under a line).
 *  Resumable through doneSteps. Returns the first appended line, if any. */
export async function runAppendSteps(
    app: App, cfg: DailyNoteConfig, today: string, cur: () => EditorState, commit: (patch: Partial<EditorState>) => void,
): Promise<{path: string; line: number} | null> {
    const s0 = cur()
    const {lines, patches} = planOutlinePatches(parseOutline(s0.outline).lines, {dropPatchOnlyRoots: !s0.underLine})
    for (const p of patches) {
        const step = `patch:${p.name.toLowerCase()}`
        if (cur().doneSteps.includes(step)) continue
        const file = await applyNotePatch(app, p, cfg)
        commit({touchedPaths: [...cur().touchedPaths, file.path], doneSteps: [...cur().doneSteps, step]})
    }
    if (cur().doneSteps.includes("outline") || lines.length === 0) return null
    if (s0.underLine) {
        const {path, line, expectedLine} = s0.underLine
        const r = await appendUnderLine(app, path, line, expectedLine, renderOutline(lines, 0).map(l => stampAppendedLine(l, today)))
        commit({touchedPaths: [...cur().touchedPaths, path], doneSteps: [...cur().doneSteps, "outline"]})
        return {path, line: r.line}
    }
    const outline = parseOutline(stampNewOutlineLines(renderOutline(lines, 0), today).join("\n")).lines
    const {file, line} = await appendToDailyNote(app, outline, cfg)
    commit({touchedPaths: [...cur().touchedPaths, file.path], doneSteps: [...cur().doneSteps, "outline"]})
    return line === null ? null : {path: file.path, line}
}

/** Rows to select after an Append Save: the appended line, the line it went under, then the parent note. */
export function appendTargets(s: EditorState, appended: {path: string; line: number} | null): RowTarget[] {
    return [
        ...(appended ? [appended] : []),
        ...(s.underLine ? [{path: s.underLine.path, line: s.underLine.line}] : []),
        ...(s.parentName ? [{key: `[[${s.parentName.toLowerCase()}]]`}] : []),
    ]
}

export const EditorMolecule = molecule((mol, scope) => {
    const scp = scope(SearchViewScope)
    const view = mol(SearchViewMolecule)

    /** The editor's state: the Alt-Edit / prose session if any, else the Append draft. Writes go to the slot
     *  matching the state's mode; null clears the shown one. */
    const editorStateAtom = atom(
        get => get(GlobalAtoms.editSessionAtom) ?? get(appendDraftAtom),
        (get, set, next: EditorState | null) => {
            if (next) set(next.mode === "append" ? appendDraftAtom : GlobalAtoms.editSessionAtom, next)
            else if (get(GlobalAtoms.editSessionAtom)) set(GlobalAtoms.editSessionAtom, null)
            else set(appendDraftAtom, null)
        })

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

    /** Appends under `parentName`: the draft if it already targets it, else a fresh draft prefilled under it. */
    const openAppendAtom = atom(null, (_get, set, parentName: string) => set(showEditorAtom, {kind: "link", name: parentName}))

    const openEditAtom = atom(null, async (get, set, row: TreeNode) => {
        const app = get(GlobalAtoms.appAtom)
        const node = row.node
        if (node.nodeType === "attachment") {
            set(showEditorAtom, {kind: "session", state: fileRenameState(node.location.path, node.name)})
            return
        }
        const path = node.location.path
        const line = node.location.position.start.line
        const text = await readLine(app, path, line)
        const isList = text !== null && LIST_ITEM_RE.test(text)
        const split = text !== null && (isList || HEADER_RE.test(text)) && lineHasIdentity(text, row.node)
            ? splitEditableLine(text)
            : null
        if (text === null || !split) {
            await markOutOfDate(app, get(GlobalAtoms.indexAtom), path)
            return
        }
        set(showEditorAtom, {kind: "session", state: {
            ...emptySession(),
            mode: "edit",
            sourcePath: path,
            line,
            originalLine: text,
            linePrefix: split.prefix,
            editKind: isList ? "list" : "heading",
            outline: split.text,
            nested: node.nodeType === "text" && node.nested === true,
            caret: split.text.length,
        }})
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

    const openAppendForSelectedAtom = atom(null, async (get, set) => {
        const {rows, pos} = selectedPos(get)
        if (pos < 0) return
        const target = appendTargetAt(rows, pos, get(view.timelineActiveAtom))
        if (target) set(openAppendAtom, target.parentName)
    })

    const openEditForSelectedAtom = atom(null, async (get, set) => {
        const {rows, pos} = selectedPos(get)
        if (pos < 0) return
        if (isEditableRow(rows[pos], get(ownPathAtom), get(view.timelineActiveAtom))) await set(openEditAtom, rows[pos])
    })

    /** Paste for the editor to apply right after it mounts (the chain's large paste). */
    const pendingPasteAtom = atom<PasteData | null>(null)

    const dailyNameOf = (get: Getter) => basenameOf(dailyNotePath(dailyConfigOf(get(GlobalAtoms.indexAtom))))

    /** The chip for a selected row or a closed `[[name]]` query (appendPickFor); null (after a notice) when refused. */
    const anchorStepFor = async (get: Getter, pick: AppendPick, label: string, prevQuery: string): Promise<ChainStep | null> => {
        const row = (anchor: ChainAnchor, l = label): ChainStep => ({kind: "row", anchor, label: l, prevQuery})
        switch (pick.kind) {
            case "refuse":
                new Notice("Can't add under this row")
                return null
            case "draft":
                return row({kind: "today"}, "Today")
            case "link": {
                const hash = pick.name.indexOf("#")
                return hash < 0
                    ? row({kind: "note", name: pick.name})
                    : row({kind: "header", page: pick.name.slice(0, hash), header: pick.name.slice(hash + 1)})
            }
            case "line": {
                const app = get(GlobalAtoms.appAtom)
                const node = pick.node
                const path = node.location.path
                const line = node.location.position.start.line
                const head = await readLine(app, path, line)
                if (!isRowLine(head, node)) {
                    await markOutOfDate(app, get(GlobalAtoms.indexAtom), path)
                    return null
                }
                return row({kind: "line", node, target: {path, line, expectedLine: head, label: rowLabel(node)}})
            }
        }
    }

    /** `>` in the search input: the selected row becomes the chain's anchor chip; with no row selected, a closed
     *  `[[name]]` query or today does, and today pre-fills the input from the search (`chainPrefill`). Once the chain
     *  has entries, or the input is one (`[[note]]`, `|alias`, `#heading`, `(key:: value)`, `- item`), the typed text
     *  becomes an entry chip. Nothing is written until Enter. */
    const pushChainAtom = atom(null, async (get, set) => {
        const chain = get(view.chainAtom)
        if (chain?.mode === "reparent") return
        const dailyName = dailyNameOf(get)
        const q = get(view.actualQueryAtom)
        const sel = get(view.selectedNodeAtom)
        const row = sel && !sel.archiveRow ? sel.node : null
        const steps = chain?.steps ?? []
        const hasEntries = steps.some(s => s.kind === "entry")
        let step: ChainStep | null
        let prefill = ""
        if (row && !hasEntries && (chain === null || !isEntryInput(q))) {
            step = await anchorStepFor(get, appendPickFor(row, "", dailyName), rowLabel(row), q)
        } else if (chain === null) {
            const pick = appendPickFor(null, q, dailyName)
            step = await anchorStepFor(get, pick, pick.kind === "link" ? pick.name : "", q)
            if (step?.kind === "row" && step.anchor.kind === "today") prefill = chainPrefill(get(view.searchTextAtom), get(separatorAtom), get(settingsAtom).archiveTag)
        } else {
            const parsed = parseChainEntry(q)
            if (parsed === null) return
            if ("error" in parsed) {
                new Notice(parsed.error)
                return
            }
            step = {kind: "entry", entry: parsed, label: q.trim(), prevQuery: q}
            const check = chainOutline([...steps, step], null, dailyName)
            if ("error" in check) {
                new Notice(check.error)
                return
            }
        }
        if (!step) return
        set(view.chainAtom, {...chain, mode: "append", steps: [...steps, step]})
        setViewQuery(set, prefill)
        if (prefill !== "") set(view.focusSearchInputAtom, get(view.focusSearchInputAtom) + 1)
    })

    /** Opening a row or a link in the Search modal and pane: its Patch view (the `>` chain anchored at it, with the
     *  content pane), as a new chain or the next chip of an append chain with only row chips whose input isn't an entry. `link`
     *  is a note (`Name`) or heading (`Name#Heading`); null opens the selected row (a page, header or line). False when
     *  it doesn't apply (another view, chain or input, no such row, a link to a file that isn't a note): the caller then
     *  opens it in Obsidian. */
    const openPatchViewAtom = atom(null, async (get, set, link: string | null): Promise<boolean> => {
        if (!scp.allowEditing) return false
        const chain = get(view.chainAtom)
        const q = get(view.actualQueryAtom)
        if (chain !== null && (chain.mode !== "append" || chain.steps.some(s => s.kind === "entry") || isEntryInput(q))) return false
        const dailyName = dailyNameOf(get)
        let pick: AppendPick
        let label: string
        if (link === null) {
            const sel = get(view.selectedNodeAtom)
            if (!sel || sel.archiveRow || !isPatchable(sel.node)) return false
            pick = appendPickFor(sel.node, "", dailyName)
            label = rowLabel(sel.node)
        } else {
            const page = link.split("#")[0].trim()
            const file = get(GlobalAtoms.appAtom).metadataCache.getFirstLinkpathDest(page, "")
            if (!page || (file ? file.extension !== "md" : /\.(?!md$)[a-z0-9]+$/i.test(page))) return false
            pick = link.toLowerCase() === dailyName.toLowerCase() ? {kind: "draft"} : {kind: "link", name: link}
            label = link.replace("#", " > ")
        }
        const step = await anchorStepFor(get, pick, label, q)
        if (step) {
            set(view.chainAtom, {...chain, mode: "append", steps: [...(chain?.steps ?? []), step]})
            setViewQuery(set, "")
            set(view.searchVisibleAtom, true)
        }
        return true
    })

    let committing = false
    /** Enter in an append chain: writes the chain through the editor's append Save (note patches, then the outline),
     *  keeps the anchor chips for the next entry, and selects the written row; and the content pane's unsaved buffers,
     *  which are written first (a heading patch appends after them); with no pending chain write it writes only the
     *  buffers. */
    const commitChainAtom = atom(null, async (get, set) => {
        if (committing) return
        const write = get(view.chainWriteAtom)
        const dirty = dirtyBodyPaths(get(view.chainBodiesAtom))
        if (write === null && dirty.length === 0) return
        if (write !== null && "error" in write) {
            new Notice(write.error)
            return
        }
        const app = get(GlobalAtoms.appAtom)
        const index = get(GlobalAtoms.indexAtom)
        const cfg = dailyConfigOf(index)
        const today = localIsoDate(new Date())
        const written: string[] = []
        let s: EditorState | null = null
        committing = true
        try {
            for (const path of dirty) {
                const b = get(view.chainBodiesAtom)[path]
                if (!b || b.text === b.original) continue
                const saved = b.text
                written.push((await writeNoteBody(app, path, b.original, saved)).path)
                const now = get(view.chainBodiesAtom)
                if (now[path]) set(view.chainBodiesAtom, {...now, [path]: {...now[path], original: saved}})
            }
            set(view.bodyDiscardArmedAtom, false)
            if (write === null) {
                await refreshPaths(app, index, written)
                return
            }
            s = {
                ...emptySession(), mode: "append", sourcePath: dailyNotePath(cfg),
                parentName: write.parentName, underLine: write.underLine,
                outline: renderOutline(write.lines, 0).join("\n"), caret: 0,
            }
            const appended = await runAppendSteps(app, cfg, today, () => s!, p => { s = {...s!, ...p} })
            const chain = get(view.chainAtom)
            if (chain?.mode === "append") set(view.chainAtom, {...chain, steps: chain.steps.filter(st => st.kind === "row")})
            setViewQuery(set, "")
            set(GlobalAtoms.pendingSelectAtom, {view: scp.name, targets: appendTargets(s, appended), flash: true})
            await refreshPaths(app, index, [...written, ...s.touchedPaths])
        } catch (err) {
            // The chain and the unsaved buffers stay for a retry; patches are idempotent and saved buffers are clean.
            const touched = [...written, ...(s?.touchedPaths ?? [])]
            if (err instanceof StaleLineError && s?.underLine) new Notice(`"${s.underLine.label}" changed since you picked it — pick the line again`)
            else new Notice(`${err instanceof Error ? err.message : String(err)}\nWritten: ${touched.join(", ") || "nothing"}`)
            await refreshPaths(app, index, touched)
        } finally {
            committing = false
        }
    })

    /** Alt+Enter in an append chain (or a list/file paste): opens the Outline editor on the chain's text, applying
     *  `paste` once it mounts. Quick Add with nothing typed shows the Append draft instead. Leaving the editor restores
     *  the query typed before the chain. */
    const openChainEditorAtom = atom(null, (get, set, paste: PasteData | null) => {
        const chain = get(view.chainAtom)
        if (chain?.mode !== "append") return
        const parsed = parseChainEntry(get(view.actualQueryAtom))
        if (parsed !== null && "error" in parsed) {
            new Notice(parsed.error)
            return
        }
        if (chain.steps.length === 0 && parsed === null && paste === null) {
            if (!set(view.releaseBodiesAtom, null)) return
            set(view.chainAtom, null)
            setViewQuery(set, chainPrevQuery(chain))
            set(showEditorAtom, {kind: "draft"})
            return
        }
        const o = chainOutline(chain.steps, parsed, dailyNameOf(get))
        if ("error" in o) {
            new Notice(o.error)
            return
        }
        const {outline, caret} = chainEditorText(o)
        if (!set(view.releaseBodiesAtom, null)) return
        set(pendingPasteAtom, paste)
        set(view.chainAtom, null)
        setViewQuery(set, chainPrevQuery(chain))
        set(showEditorAtom, {kind: "outline", parentName: o.parentName, underLine: o.underLine, outline, caret})
    })

    /** A multi-line or file paste in an append chain: a list, files, or a chain with entries continue in the Outline
     *  editor; prose opens the prose editor on the anchor (a whole note, or a new note linked from the line). */
    const pasteIntoChainAtom = atom(null, async (get, set, data: PasteData) => {
        const chain = get(view.chainAtom)
        if (chain?.mode !== "append") return
        const hasEntries = chain.steps.some(s => s.kind === "entry")
        const typed = parseChainEntry(get(view.actualQueryAtom))
        const lines = data.plain.split(/\r?\n/).filter(l => l.trim() !== "")
        if (hasEntries || typed !== null || data.files.length > 0 || (lines.length > 0 && lines.every(l => LIST_ITEM_RE.test(l)))) {
            set(openChainEditorAtom, data)
            return
        }
        const anchor = chain.steps[chain.steps.length - 1]
        if (anchor && anchor.kind !== "row") return
        const text = data.plain.replace(/\r\n?/g, "\n")
        if (!set(view.releaseBodiesAtom, null)) return
        set(view.chainAtom, null)
        setViewQuery(set, chainPrevQuery(chain))
        // Quick Add before its first chip writes into today's daily note.
        const a: ChainAnchor = anchor?.anchor ?? {kind: "today"}
        await set(openProseAtom,
            a.kind === "today" ? {kind: "note", noteName: null, text}
            : a.kind === "note" ? {kind: "note", noteName: a.name, text}
            : a.kind === "header" ? {kind: "note", noteName: a.page, text}
            : {kind: "line", line: a.target, text})
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
        let appended: {path: string; line: number} | null = null
        const today = localIsoDate(new Date())
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

            if (s.mode === "append") appended = await runAppendSteps(app, cfg, today, () => s, commit)
            if (s.mode === "edit" && s.editKind === "file" && !s.doneSteps.includes("rename")) {
                const path = await renameVaultFile(app, s.sourcePath, s.outline)
                commit({touchedPaths: [...s.touchedPaths, path], doneSteps: [...s.doneSteps, "rename"]})
            }
            if (s.mode === "edit" && s.editKind !== "file" && !s.doneSteps.includes("line")) {
                const line = (s.linePrefix ?? "") + s.outline.replace(/\r?\n/g, " ").trimEnd()
                const newLine = s.nested ? line : scheduleUnscheduledTasks(line, today)
                const files = await editLine(app, s.sourcePath, s.line ?? 0, s.originalLine ?? "", newLine)
                commit({touchedPaths: [...s.touchedPaths, ...files.map(f => f.path)], doneSteps: [...s.doneSteps, "line"]})
            }
            if (s.prose?.kind === "note" && !s.doneSteps.includes("prose")) {
                const file = await writeWholeNote(app, s.prose.path, s.prose.original, s.outline)
                commit({touchedPaths: [...s.touchedPaths, file.path], doneSteps: [...s.doneSteps, "prose"]})
            }
            if (s.prose?.kind === "new") {
                const {name, link} = s.prose
                if (!s.doneSteps.includes("note")) {
                    const file = await writeNoteContents(app, name.trim(), s.outline, link.path)
                    commit({touchedPaths: [...s.touchedPaths, file.path], doneSteps: [...s.doneSteps, "note"]})
                }
                if (!s.doneSteps.includes("link")) {
                    const files = await editLine(app, link.path, link.line, link.expectedLine, withTrailingLink(link.expectedLine, name.trim()))
                    commit({touchedPaths: [...s.touchedPaths, ...files.map(f => f.path)], doneSteps: [...s.doneSteps, "link"]})
                }
            }
        } catch (err) {
            if (err instanceof StaleLineError && s.underLine) {
                new Notice(`"${s.underLine.label}" changed since you picked it — pick the line again`)
                commit({saving: false})
                return
            }
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
        const targets: RowTarget[] = s.mode === "append" ? appendTargets(s, appended)
            : s.prose?.kind === "note" ? [{key: `[[${basenameOf(s.prose.path).toLowerCase()}]]`}]
            : s.prose?.kind === "new" ? [{path: s.prose.link.path, line: s.prose.link.line}, {key: `[[${s.prose.name.trim().toLowerCase()}]]`}]
            : s.editKind === "file" ? [renamedFileTarget(s.touchedPaths[s.touchedPaths.length - 1])]
            : [{path: s.sourcePath, line: s.line ?? 0}]
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

    /** Opens the prose editor on a whole note (`noteName` null: today's daily note), or on a new note to link from an
     *  Append target's line. */
    const openProseAtom = atom(null, async (get, set, request: ProseRequest) => {
        const app = get(GlobalAtoms.appAtom)
        const index = get(GlobalAtoms.indexAtom)
        const dailyPath = dailyNotePath(dailyConfigOf(index))
        let prose: ProseTarget
        let outline: string
        if (request.kind === "note") {
            const {noteName} = request
            const file = noteName === null ? app.vault.getFileByPath(dailyPath) : app.metadataCache.getFirstLinkpathDest(noteName, "")
            const path = file?.path ?? (noteName === null ? dailyPath : newNotePath(app, noteName, dailyPath))
            const original = file ? await app.vault.read(file) : null
            outline = original === null ? request.text ?? "" : request.text ? appendContent(original, request.text) : original
            prose = {kind: "note", path, original}
        } else {
            const {path, line, expectedLine} = request.line
            const head = await readLine(app, path, line)
            if (head !== expectedLine) {
                await markOutOfDate(app, index, path)
                return
            }
            outline = request.text ?? ""
            // An empty name keeps Save blocked ("Name the new note") until one is typed.
            prose = {kind: "new", name: proseNameFrom(outline), link: {path, line, expectedLine: head}}
        }
        set(showEditorAtom, {kind: "session", state: {
            ...emptySession(),
            mode: "prose",
            sourcePath: prose.kind === "note" ? prose.path : prose.link.path,
            outline,
            caret: outline.length,
            prose,
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
        updateEditorAtom, cancelEditorAtom, closeEditorAtom, openAppendAtom, openEditAtom, openRenameFileAtom, openSaveFilterAtom, openRenameFilterAtom,
        openAppendForSelectedAtom, openEditForSelectedAtom, saveEditorAtom,
        clearDragAtom, reparentAtom, editTaskAtom, deleteRowAtom,
        reparentChainAtom, archiveDrawerAtom, openProseAtom,
        pendingPasteAtom, pushChainAtom, openPatchViewAtom, commitChainAtom, openChainEditorAtom, pasteIntoChainAtom,
    }
})
