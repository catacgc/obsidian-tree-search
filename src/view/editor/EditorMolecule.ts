// Per-view editor-mode state (EDITOR.md): the one inline editor (Append / Alt-Edit),
// the Alt-held flag, drag state, and the save / reparent flows. Scoped like
// SearchViewMolecule so the pane and the modal each have their own editor.
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
import {settingsAtom} from "../react-context/settings"
import type {TreeNode} from "../search/SearchViewFlatten"
import type {DailyNoteConfig} from "../../indexing/indexed-tree"
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
import {appendPrefill, replaceOutlineParent} from "./textarea-ops"

export type EditorState = {
    sessionId: number
    mode: "append" | "edit"
    /** The row whose ⊕ / Alt-Edit opened the editor; absent for the blank on-demand editor. */
    target?: TreeNode
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
    /** Bumped when an open Append editor is re-targeted or re-requested; the editor then focuses its outline. */
    focusNonce: number
}

const OUT_OF_DATE = "This row's index is out of date — try again in a moment"
const DEFAULT_DAILY: DailyNoteConfig = {folder: "", format: "YYYY-MM-DD", template: ""}

let lastSessionId = 0
const nextSessionId = () => (lastSessionId = Math.max(lastSessionId + 1, Date.now()))

export const basenameOf = (path: string) => path.split("/").pop()!.replace(/\.md$/, "")

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
    scope(SearchViewScope)
    const view = mol(SearchViewMolecule)

    const editorStateAtom = atom<EditorState | null>(null)
    const altHeldAtom = atom(false)
    /** Renderable position of the row being dragged. */
    const dragIndexAtom = atom<number | null>(null)
    const dropTargetAtom = atom<number | null>(null)

    const ownPathAtom = atom(get => {
        get(GlobalAtoms.graphVersionAtom)
        return makeOwnPath(get(GlobalAtoms.graphAtom))
    })

    const dailyConfig = (index: {getDailyNoteConfig(): DailyNoteConfig} | null) => index?.getDailyNoteConfig() ?? DEFAULT_DAILY

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

    const emptySession = () => ({
        sessionId: nextSessionId(),
        contents: {}, contentOrder: [], activeContent: null,
        attachments: [], doneSteps: [], touchedPaths: [], saving: false, focusNonce: 0,
    })

    /** Opens Append under `parentName`; an open Append editor keeps its buffers and only swaps its parent line. */
    const openAppendAtom = atom(null, async (get, set, target: TreeNode, parentName: string) => {
        const s = get(editorStateAtom)
        if (s?.mode === "append") {
            if (s.saving) return
            set(editorStateAtom, {
                ...s, target, parentName,
                outline: replaceOutlineParent(s.outline, parentName),
                focusNonce: s.focusNonce + 1,
            })
            return
        }
        await set(cancelEditorAtom)
        set(editorStateAtom, {
            ...emptySession(),
            mode: "append",
            target,
            parentName,
            sourcePath: dailyNotePath(dailyConfig(get(GlobalAtoms.indexAtom))),
            outline: appendPrefill(parentName),
        })
    })

    /** Opens a blank Append editor whose roots go to today's daily note; focuses an already open Append editor instead. */
    const openBlankEditorAtom = atom(null, async (get, set) => {
        const s = get(editorStateAtom)
        if (s?.mode === "append") {
            set(editorStateAtom, {...s, focusNonce: s.focusNonce + 1})
            return
        }
        await set(cancelEditorAtom)
        set(editorStateAtom, {
            ...emptySession(),
            mode: "append",
            sourcePath: dailyNotePath(dailyConfig(get(GlobalAtoms.indexAtom))),
            outline: "- ",
        })
    })

    const openEditAtom = atom(null, async (get, set, row: TreeNode) => {
        await set(cancelEditorAtom)
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
        set(editorStateAtom, {
            ...emptySession(),
            mode: "edit",
            target: row,
            sourcePath: path,
            line,
            originalLine: text,
            linePrefix: split.prefix,
            editKind: isList ? "list" : "heading",
            outline: split.text,
        })
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
        if (target) await set(openAppendAtom, target.target, target.parentName)
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

        const cfg = dailyConfig(index)
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

            if (s.mode === "append" && !s.doneSteps.includes("outline")) {
                const files = await appendToDailyNote(app, parseOutline(s.outline).lines, cfg)
                commit({touchedPaths: [...s.touchedPaths, ...files.map(f => f.path)], doneSteps: [...s.doneSteps, "outline"]})
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

        // Back to the search once saved, unless another editor was opened in the meantime.
        if (get(editorStateAtom)?.sessionId === s.sessionId) {
            set(editorStateAtom, null)
            set(view.focusSearchInputAtom, n => n + 1)
        }
        await refreshPaths(app, index, s.touchedPaths)
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
