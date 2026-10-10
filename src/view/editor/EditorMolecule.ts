// Per-view editor-mode state (EDITOR.md): the inline editor (Append draft / Alt-Edit /
// prose), the Alt-held flag, drag state, and the save / reparent flows. Scoped like
// SearchViewMolecule. The editor is shown by Quick Add (its own modal) and in place by the
// Search modal and pane; requests change the draft or session through quick-add-flow.ts.
import {atom, type Getter, type Setter} from "jotai"
import {molecule} from "bunshi"
import {Notice, type App, type TFile} from "obsidian"
import {
    appendContent,
    appendOutlineEmpty,
    editorHints,
    getKey,
    HEADER_RE,
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
    StaleLineError,
    type EditorHint,
    type ParsedNode,
} from "@mdtree/core"
import {SearchViewMolecule, SearchViewScope} from "../react-context/state"
import {GlobalAtoms} from "../react-context/global"
import {applyEditorRequestAtom, leaveQuickAddAtom, type EditorRequest} from "../react-context/quick-add-flow"
import {type RowTarget} from "../search/select-target"
import {appendDraftAtom, settingsAtom} from "../react-context/settings"
import type {TreeNode} from "../search/SearchViewFlatten"
import {basenameOf, dailyConfigOf, emptySession, proseNameFrom} from "./draft"
import type {PasteData} from "./textarea-ops"
import {
    appendToDailyNote,
    appendUnderLine,
    applyNotePatch,
    applyAttachmentPlan,
    dailyNotePath,
    editLine,
    editTaskLine,
    newNotePath,
    readLine,
    renameVaultFile,
    reparent,
    trashSessionAttachments,
    writeNoteContents,
    writeWholeNote,
    type EditorAttachment,
    type ReparentPlan,
    type TaskChange,
} from "../../editing/vault-edits"
import type {DailyNoteConfig} from "../../indexing/indexed-tree"
import {appendTargetAt, classifyReparent, isEditableRow, type OwnPath} from "./row-editing"
import {
    chainEditorText,
    chainOutline,
    isEntryInput,
    parseChainEntry,
    planReparent,
    rowLabel,
    type ChainAnchor,
    type ChainStep,
    type NewPageTarget,
} from "../search/chain"
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
    /** Edit: the line as read from the file; Rename of a file: its current name. */
    originalLine?: string
    linePrefix?: string
    /** Edit: a list line or a heading (Rename); "file": Rename of an attachment, the outline holds its name without extension. */
    editKind?: "list" | "heading" | "file"
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
export function editorHintsFor(app: App, s: EditorState): EditorHint[] {
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
        datedLines: s.mode === "append" && s.underLine !== undefined,
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

/** Save is disabled by any blocking hint, or by an Append outline that adds nothing. */
export function isSaveBlocked(app: App, s: EditorState): boolean {
    return editorHintsFor(app, s).some(h => h.blocking) || (s.mode === "append" && appendOutlineEmpty(s.outline, s.parentName))
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
    const outline = parseOutline(scheduleUnscheduledTasks(renderOutline(lines, 0).join("\n"), today)).lines
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

    /** Shows `request` in this view's editor: the Search modal or pane switches to it; in Quick Add it replaces the shown session. */
    const showEditorAtom = atom(null, (_get, set, request: EditorRequest) => {
        set(applyEditorRequestAtom, request)
        if (!scp.isQuickAdd) set(view.enterEditorAtom)
    })

    /** Closes the editor: Quick Add closes its modal; a Search view returns to its search (`saved`: the written rows to select). */
    const closeEditorAtom = atom(null, (_get, set, exit: {kind: "saved"; targets: RowTarget[]} | {kind: "cancelled"}) => {
        if (scp.isQuickAdd) set(leaveQuickAddAtom, {kind: exit.kind})
        else set(view.leaveEditorAtom, {saved: exit.kind === "saved" ? exit.targets : null, focus: true})
    })

    /** Appends under `parentName`: the draft if it already targets it, else a fresh draft prefilled under it. */
    const openAppendAtom = atom(null, (_get, set, parentName: string) => set(showEditorAtom, {kind: "link", name: parentName}))

    /** Shows the Append draft (a blank one if none); its roots go to today's daily note. */
    const openBlankEditorAtom = atom(null, (_get, set) => set(showEditorAtom, {kind: "draft"}))

    const openEditAtom = atom(null, async (get, set, row: TreeNode) => {
        const app = get(GlobalAtoms.appAtom)
        const node = row.node
        if (node.nodeType === "attachment") {
            const stem = node.extension ? node.name.slice(0, -(node.extension.length + 1)) : node.name
            set(showEditorAtom, {kind: "session", state: {
                ...emptySession(), mode: "edit", editKind: "file",
                sourcePath: node.location.path, originalLine: node.name, outline: stem, caret: stem.length,
            }})
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
            case "none":
                return null
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

    /** `>` in the search input: the selected row (or a closed `[[name]]` query, or today) becomes the chain's anchor
     *  chip; once the chain has entries, or the input is one (`[[note]]`, `|alias`, `#heading`, `(key:: value)`,
     *  `- item`), the typed text becomes an entry chip. Nothing is written until Enter. */
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
        if (row && !hasEntries && (chain === null || !isEntryInput(q))) {
            step = await anchorStepFor(get, appendPickFor(row, "", dailyName), rowLabel(row), q)
        } else if (chain === null) {
            const pick = appendPickFor(null, q, dailyName)
            step = await anchorStepFor(get, pick, pick.kind === "link" ? pick.name : "", q)
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
        set(view.chainAtom, {mode: "append", steps: [...steps, step]})
        setViewQuery(set, "")
    })

    let committing = false
    /** Enter in an append chain: writes the chain through the editor's append Save (note patches, then the outline),
     *  keeps the anchor chips for the next entry, and selects the written row. */
    const commitChainAtom = atom(null, async (get, set) => {
        if (committing) return
        const write = get(view.chainWriteAtom)
        if (write === null) return
        if ("error" in write) {
            new Notice(write.error)
            return
        }
        const app = get(GlobalAtoms.appAtom)
        const index = get(GlobalAtoms.indexAtom)
        const cfg = dailyConfigOf(index)
        const today = localIsoDate(new Date())
        let s: EditorState = {
            ...emptySession(), mode: "append", sourcePath: dailyNotePath(cfg),
            parentName: write.parentName, underLine: write.underLine,
            outline: renderOutline(write.lines, 0).join("\n"), caret: 0,
        }
        committing = true
        let appended: {path: string; line: number} | null
        try {
            appended = await runAppendSteps(app, cfg, today, () => s, p => { s = {...s, ...p} })
        } catch (err) {
            // The chain stays for a retry; patches are idempotent.
            if (err instanceof StaleLineError && s.underLine) new Notice(`"${s.underLine.label}" changed since you picked it — pick the line again`)
            else new Notice(`${err instanceof Error ? err.message : String(err)}\nWritten: ${s.touchedPaths.join(", ") || "nothing"}`)
            await refreshPaths(app, index, s.touchedPaths)
            return
        } finally {
            committing = false
        }
        const chain = get(view.chainAtom)
        if (chain?.mode === "append") set(view.chainAtom, {...chain, steps: chain.steps.filter(st => st.kind === "row")})
        setViewQuery(set, "")
        set(GlobalAtoms.pendingSelectAtom, {view: scp.name, targets: appendTargets(s, appended), flash: true})
        await refreshPaths(app, index, s.touchedPaths)
    })

    /** Alt+Enter in an append chain (or a list/file paste): opens the Outline editor on the chain's text, applying
     *  `paste` once it mounts. Leaving the editor restores the query typed before the chain. */
    const openChainEditorAtom = atom(null, (get, set, paste: PasteData | null) => {
        const chain = get(view.chainAtom)
        if (chain?.mode !== "append") return
        const parsed = parseChainEntry(get(view.actualQueryAtom))
        if (parsed !== null && "error" in parsed) {
            new Notice(parsed.error)
            return
        }
        const o = chainOutline(chain.steps, parsed, dailyNameOf(get))
        if ("error" in o) {
            new Notice(o.error)
            return
        }
        const {outline, caret} = chainEditorText(o)
        set(pendingPasteAtom, paste)
        set(view.chainAtom, null)
        setViewQuery(set, chain.steps[0].prevQuery)
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
        if (anchor.kind !== "row") return
        const text = data.plain.replace(/\r\n?/g, "\n")
        set(view.chainAtom, null)
        setViewQuery(set, chain.steps[0].prevQuery)
        const a = anchor.anchor
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
        if (isSaveBlocked(app, start)) return
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
            : s.editKind === "file" ? [{key: s.touchedPaths[s.touchedPaths.length - 1].split("/").pop()!.toLowerCase()}]
            : [{path: s.sourcePath, line: s.line ?? 0}]
        // Quick Add opens the Search modal after it closes; set before the refresh so its recompute re-finds the row.
        if (scp.isQuickAdd) set(GlobalAtoms.pendingSelectAtom, {view: "modal", targets, flash: true})
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
                plan = {...plan, head}
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

    /** Enter in reparent mode: moves the chain's row under `target` (a result row, or a typed new page name). */
    const reparentChainAtom = atom(null, async (get, set, target: ParsedNode | NewPageTarget) => {
        const chain = get(view.chainAtom)
        if (chain?.mode !== "reparent") return
        const app = get(GlobalAtoms.appAtom)
        const index = get(GlobalAtoms.indexAtom)
        const cfg = dailyConfigOf(index)
        const child = chain.child
        const source = child.node.location.path
        try {
            const planned = planReparent(child, target, {ownPath: get(ownPathAtom), relation: get(settingsAtom).parentRelation, cfg})
            if ("error" in planned) {
                new Notice(planned.error)
                return
            }
            let plan: ReparentPlan = planned
            if (plan.kind === "to-daily" || plan.kind === "under-line") {
                const head = await readLine(app, plan.sourcePath, plan.line)
                if (!isRowLine(head, child.node)) {
                    await markOutOfDate(app, index, source)
                    return
                }
                const destPath = plan.kind === "to-daily" ? dailyNotePath(cfg) : plan.targetPath
                const ms = destPath !== plan.sourcePath ? index?.periodicDateOf(plan.sourcePath) ?? null : null
                const stampDate = ms === null ? null : localIsoDate(new Date(ms))
                if (plan.kind === "under-line") {
                    const targetHead = await readLine(app, plan.targetPath, plan.targetLine)
                    if (target.nodeType !== "text" || !isRowLine(targetHead, target)) {
                        await markOutOfDate(app, index, plan.targetPath)
                        return
                    }
                    plan = {...plan, head, targetHead, stampDate}
                } else {
                    plan = {...plan, head, stampDate}
                }
            }
            const touched = await reparent(app, plan)
            set(view.chainAtom, null)
            setViewQuery(set, chain.prevQuery)
            set(GlobalAtoms.pendingSelectAtom, {view: scp.name, targets: [{key: getKey(child.node)}], flash: true})
            // Renamed paths aren't reindexed by refreshPage (the index has no rename handler): rebuild it.
            if (plan.kind === "to-folder") await index?.refresh()
            else await refreshPaths(app, index, touched.map(f => f.path))
        } catch (err) {
            if (err instanceof StaleLineError) await markOutOfDate(app, index, source)
            else new Notice(err instanceof Error ? err.message : String(err))
        }
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

    return {
        editorStateAtom, altHeldAtom, dragIndexAtom, dropTargetAtom, ownPathAtom,
        updateEditorAtom, cancelEditorAtom, closeEditorAtom, openAppendAtom, openBlankEditorAtom, openEditAtom,
        openAppendForSelectedAtom, openEditForSelectedAtom, saveEditorAtom,
        clearDragAtom, reparentAtom, editTaskAtom,
        reparentChainAtom, openProseAtom,
        pendingPasteAtom, pushChainAtom, commitChainAtom, openChainEditorAtom, pasteIntoChainAtom,
    }
})
