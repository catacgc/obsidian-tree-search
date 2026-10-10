// Editor requests and Quick Add, the standalone host of the shared inline editor. Every
// editor request (the commands, a Search view's `>` / ⊕ / Alt+A / Alt-Edit) is applied to
// the Append draft or a transient Alt-Edit / prose session by applyEditorRequestAtom; the
// Search modal and pane then show the editor in place (SearchViewMolecule.enterEditorAtom),
// while the Quick Add command opens it in its own modal. A Quick Add save opens the Search
// modal on the written row; a close just closes.
import {atom} from "jotai"
import {GlobalAtoms} from "./global"
import {appendDraftAtom} from "./settings"
import type {EditorState, UnderLine} from "../editor/EditorMolecule"
import {dailyConfigOf, emptySession, newAppendState, newUnderLineState} from "../editor/draft"
import {dailyNotePath, trashSessionAttachments} from "../../editing/vault-edits"

export type EditorRequest =
    /** Show the Append draft; start a blank one (`- `) if none. */
    | {kind: "draft"}
    /** Keep the draft when it already appends to `name`; else replace it (trashing its pasted attachments) with a
     *  new draft prefilled `- [[name]]\n    - `. */
    | {kind: "link"; name: string}
    /** Keep the draft when it already appends under this line (same path, line and text); else replace it, trashing
     *  its pasted attachments. */
    | {kind: "line"; target: UnderLine}
    /** A chain opened in the editor: replaces the draft (trashing its pasted attachments). */
    | {kind: "outline"; parentName?: string; underLine?: UnderLine; outline: string; caret: number}
    /** A transient Alt-Edit or prose session over the draft. */
    | {kind: "session"; state: EditorState}

/** Why Quick Add closed: an editor save or a user close (Escape, ✕, Cancel/Discard). */
export type QuickAddExit = {kind: "saved"} | {kind: "cancelled"}

/** Applies `request` to the Append draft or the transient session; the single place requests change them. */
export const applyEditorRequestAtom = atom(null, (get, set, request: EditorRequest) => {
    // A draft started on an earlier day is aimed at today's note.
    const today = dailyNotePath(dailyConfigOf(get(GlobalAtoms.indexAtom)))
    const draft = get(appendDraftAtom)
    const replace = (next: EditorState) => {
        if (draft) void trashSessionAttachments(get(GlobalAtoms.appAtom), draft.attachments)
        set(appendDraftAtom, next)
    }
    if (request.kind === "session") {
        set(GlobalAtoms.editSessionAtom, request.state)
    } else if (request.kind === "link") {
        // Link names are case-insensitive, like Obsidian's links and the graph's page keys.
        if (draft && !draft.underLine && draft.parentName?.toLowerCase() === request.name.toLowerCase()) {
            set(appendDraftAtom, {...draft, sourcePath: today})
        } else {
            replace(newAppendState(today, request.name))
        }
    } else if (request.kind === "line") {
        const t = request.target
        const u = draft?.underLine
        if (draft && u && u.path === t.path && u.line === t.line && u.expectedLine === t.expectedLine) {
            set(appendDraftAtom, {...draft, sourcePath: today})
        } else {
            replace(newUnderLineState(today, t))
        }
    } else if (request.kind === "outline") {
        const {parentName, underLine, outline, caret} = request
        replace({...emptySession(), mode: "append", sourcePath: today, parentName, underLine, outline, caret})
    } else {
        set(appendDraftAtom, draft ? {...draft, sourcePath: today} : newAppendState(today))
    }
})

/** Opens Quick Add on `request`; the Search modal, if it is the current modal, closes. */
export const openQuickAddAtom = atom(null, (get, set, request: EditorRequest) => {
    const modals = get(GlobalAtoms.modalsAtom)
    if (!modals) return
    set(GlobalAtoms.quickAddExitAtom, null)
    set(applyEditorRequestAtom, request)
    set(GlobalAtoms.editorHostAtom, "quickAdd")
    if (get(GlobalAtoms.currentModalAtom) === modals.search) modals.search.close()
    modals.quickAdd.open()
})

/** Closes Quick Add, recording why for `quickAddClosedAtom`. */
export const leaveQuickAddAtom = atom(null, (get, set, exit: QuickAddExit) => {
    set(GlobalAtoms.quickAddExitAtom, exit)
    get(GlobalAtoms.modalsAtom)?.quickAdd.close()
})

/** Quick Add's `onClose`: frees the editor; after a save, opens the Search modal (which selects the written row). */
export const quickAddClosedAtom = atom(null, (get, set) => {
    const exit = get(GlobalAtoms.quickAddExitAtom)
    set(GlobalAtoms.quickAddExitAtom, null)
    if (get(GlobalAtoms.editorHostAtom) === "quickAdd") set(GlobalAtoms.editorHostAtom, null)
    const modals = get(GlobalAtoms.modalsAtom)
    if (!modals || exit?.kind !== "saved") return
    set(GlobalAtoms.selectQueryAtom, {view: "modal"})
    // Obsidian is still closing Quick Add; open Search once it has finished.
    window.setTimeout(() => modals.search.open(), 0)
})
