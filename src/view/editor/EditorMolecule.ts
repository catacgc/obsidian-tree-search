// Per-view editor-mode state (EDITOR.md): the inline editor (Append draft / Alt-Edit),
// the Alt-held flag, drag state, and the save / reparent flows. Scoped like
// SearchViewMolecule; only Quick Add renders the editor, and the open* atoms of every
// view hand their requests to it (quick-add-flow.ts).
import {atom, type Getter} from "jotai"
import {molecule} from "bunshi"
import {Notice, type App, type TFile} from "obsidian"
import {
    appendOutlineEmpty,
    editorHints,
    getKey,
    HEADER_RE,
    LIST_ITEM_RE,
    lineHasIdentity,
    NotesGraph,
    OUTLINE_KEY,
    parseOutline,
    resolveAttachmentEmbeds,
    splitEditableLine,
    StaleLineError,
    type EditorHint,
    type ParsedNode,
} from "@mdtree/core"
import {SearchViewMolecule, SearchViewScope} from "../react-context/state"
import {GlobalAtoms} from "../react-context/global"
import {leaveQuickAddAtom, openQuickAddAtom, type EditorRequest} from "../react-context/quick-add-flow"
import {rowTargets, type RowTarget} from "../search/select-target"
import {appendDraftAtom, settingsAtom} from "../react-context/settings"
import type {TreeNode} from "../search/SearchViewFlatten"
import {basenameOf, dailyConfigOf, emptySession} from "./draft"
import {
    appendToDailyNote,
    applyAttachmentPlan,
    dailyNotePath,
    editLine,
    readLine,
    reparent,
    trashSessionAttachments,
    writeNoteContents,
    type EditorAttachment,
} from "../../editing/vault-edits"
import {appendTargetAt, classifyReparent, isEditableRow, type OwnPath} from "./row-editing"

export type EditorState = {
    sessionId: number
    mode: "append" | "edit"
    parentName?: string
    /** Append: today's daily note path; Edit: the row's file. */
    sourcePath: string
    line?: number
    originalLine?: string
    linePrefix?: string
    editKind?: "list" | "heading"
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
}

const OUT_OF_DATE = "This row's index is out of date — try again in a moment"

/** File of the page a node belongs to (headers map to their page); null for references and non-pages. */
export function makeOwnPath(graph: NotesGraph): OwnPath {
    return (n: ParsedNode) => {
        const key = n.nodeType === "header" ? `[[${n.page.toLowerCase()}]]` : getKey(n)
        if (!graph.hasNode(key)) return null
        const attrs = graph.getNodeAttributes(key)
        return attrs.nodeType === "page" && !attrs.isReference ? attrs.location.path : null
    }
}

/** Footer hints for the editor's current buffers; blocking hints disable Save. */
export function editorHintsFor(app: App, s: EditorState): EditorHint[] {
    const exists = (name: string) => !!app.metadataCache.getFirstLinkpathDest(name, "")
    const dry = resolveAttachmentEmbeds({[OUTLINE_KEY]: s.outline, ...s.contents}, s.attachments, exists)
    return editorHints({
        mode: s.mode,
        editKind: s.editKind,
        parentName: s.mode === "append" ? s.parentName ?? "" : basenameOf(s.sourcePath),
        outline: s.outline,
        contents: s.contents,
        contentOrder: s.contentOrder,
        noteExists: exists,
        attachmentError: dry.error,
    })
}

/** Save is disabled by any blocking hint, or by an Append outline that adds nothing. */
export function isSaveBlocked(app: App, s: EditorState): boolean {
    return editorHintsFor(app, s).some(h => h.blocking) || (s.mode === "append" && appendOutlineEmpty(s.outline, s.parentName))
}

export const EditorMolecule = molecule((mol, scope) => {
    const scp = scope(SearchViewScope)
    const view = mol(SearchViewMolecule)

    /** The editor Quick Add shows: the Alt-Edit session if any, else the Append draft. Writes go to the slot matching
     *  the state's mode; null clears the shown one. */
    const editorStateAtom = atom(
        get => get(GlobalAtoms.editSessionAtom) ?? get(appendDraftAtom),
        (get, set, next: EditorState | null) => {
            if (next) set(next.mode === "edit" ? GlobalAtoms.editSessionAtom : appendDraftAtom, next)
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

    /** Hands `request` to Quick Add, which hosts the editor, with this view's query and selected row. */
    const handOffAtom = atom(null, (get, set, request: EditorRequest) => {
        const sel = get(view.selectedNodeAtom)
        set(openQuickAddAtom, {
            request,
            session: {view: scp.name, reopenSearch: scp.isModal, query: get(view.actualQueryAtom), selected: sel ? rowTargets(sel) : []},
        })
    })

    /** Links `parentName` into the Append draft at its caret (a new draft prefilled under it if none). */
    const openAppendAtom = atom(null, (_get, set, parentName: string) => set(handOffAtom, {kind: "link", name: parentName}))

    /** Shows the Append draft (a blank one if none); its roots go to today's daily note. */
    const openBlankEditorAtom = atom(null, (_get, set) => set(handOffAtom, {kind: "draft"}))

    const openEditAtom = atom(null, async (get, set, row: TreeNode) => {
        const app = get(GlobalAtoms.appAtom)
        const path = row.node.location.path
        const line = row.node.location.position.start.line
        const text = await readLine(app, path, line)
        const isList = text !== null && LIST_ITEM_RE.test(text)
        const split = text !== null && (isList || HEADER_RE.test(text)) && lineHasIdentity(text, row.node)
            ? splitEditableLine(text)
            : null
        if (text === null || !split) {
            await markOutOfDate(app, get(GlobalAtoms.indexAtom), path)
            return
        }
        set(handOffAtom, {kind: "edit", state: {
            ...emptySession(),
            mode: "edit",
            sourcePath: path,
            line,
            originalLine: text,
            linePrefix: split.prefix,
            editKind: isList ? "list" : "heading",
            outline: split.text,
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

    const saveEditorAtom = atom(null, async (get, set) => {
        const start = get(editorStateAtom)
        if (!start || start.saving) return
        const app = get(GlobalAtoms.appAtom)
        const index = get(GlobalAtoms.indexAtom)
        if (isSaveBlocked(app, start)) return

        let s: EditorState = {...start, saving: true}
        const commit = (patch: Partial<EditorState>) => {
            s = {...s, ...patch}
            if (get(editorStateAtom)?.sessionId === s.sessionId) set(editorStateAtom, s)
        }
        commit({})

        const cfg = dailyConfigOf(index)
        const exists = (name: string) => !!app.metadataCache.getFirstLinkpathDest(name, "")
        let appended: {path: string; line: number} | null = null
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

            if (s.mode === "append" && !s.doneSteps.includes("outline")) {
                const {file, line} = await appendToDailyNote(app, parseOutline(s.outline).lines, cfg)
                if (line !== null) appended = {path: file.path, line}
                commit({touchedPaths: [...s.touchedPaths, file.path], doneSteps: [...s.doneSteps, "outline"]})
            }
            if (s.mode === "edit" && !s.doneSteps.includes("line")) {
                const newLine = (s.linePrefix ?? "") + s.outline.replace(/\r?\n/g, " ").trimEnd()
                const files = await editLine(app, s.sourcePath, s.line ?? 0, s.originalLine ?? "", newLine)
                commit({touchedPaths: [...s.touchedPaths, ...files.map(f => f.path)], doneSteps: [...s.doneSteps, "line"]})
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
        // Saved: back to the launching Search view, which selects and flashes the written row.
        set(editorStateAtom, null)
        const targets: RowTarget[] = s.mode === "append"
            ? [
                ...(appended ? [appended] : []),
                ...(s.parentName ? [{key: `[[${s.parentName.toLowerCase()}]]`}] : []),
            ]
            : [{path: s.sourcePath, line: s.line ?? 0}]
        // Set before the refresh: the pane re-finds the row in the recompute the refresh triggers.
        set(GlobalAtoms.pendingSelectAtom, {view: get(GlobalAtoms.quickAddSessionAtom)?.view ?? "modal", targets, flash: true})
        await refreshPaths(app, index, s.touchedPaths)
        set(leaveQuickAddAtom, {kind: "saved"})
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

    return {
        editorStateAtom, altHeldAtom, dragIndexAtom, dropTargetAtom, ownPathAtom,
        updateEditorAtom, cancelEditorAtom, openAppendAtom, openBlankEditorAtom, openEditAtom,
        openAppendForSelectedAtom, openEditForSelectedAtom, saveEditorAtom,
        clearDragAtom, reparentAtom,
    }
})
