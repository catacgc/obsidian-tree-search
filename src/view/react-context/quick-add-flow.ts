// Search ⇄ Quick Add handoff. Quick Add is the only view that hosts the inline
// editor: every editor request (the commands, Search's ⊕ / Alt+A / Alt-Edit) lands
// here and is applied to the Append draft or a transient Alt-Edit session. Quick Add
// launched from Search hands back to it on save or close; opened directly, a save
// opens the Search modal on the written row and a close just closes.
import {atom} from "jotai"
import {GlobalAtoms} from "./global"
import {appendDraftAtom} from "./settings"
import type {EditorState} from "../editor/EditorMolecule"
import {dailyConfigOf, newAppendState} from "../editor/draft"
import {dailyNotePath, trashSessionAttachments} from "../../editing/vault-edits"
import type {RowTarget} from "../search/select-target"

export type QuickAddSession = {
    /** SearchViewScope name of the launcher: "modal" (Search modal) or "Search" (pane). */
    view: string
    /** Launcher is the Search modal, reopened on exit; the pane stays open by itself. */
    reopenSearch: boolean
    /** Launcher's query, restored on exit. */
    query: string
    /** Launcher's selected row, reselected after cancel/close. */
    selected: RowTarget[]
}

export type EditorRequest =
    /** Show the Append draft; start a blank one (`- `) if none. */
    | {kind: "draft"}
    /** Keep the draft when it already appends to `name`; else replace it (trashing its pasted attachments) with a
     *  new draft prefilled `- [[name]]\n    - `. */
    | {kind: "link"; name: string}
    /** A transient Alt-Edit session over the draft. */
    | {kind: "edit"; state: EditorState}

/** Why Quick Add closed: an editor save or a user close (Escape, ✕, Cancel/Discard). */
export type QuickAddExit = {kind: "saved"} | {kind: "cancelled"}

/** Opens Quick Add with `request` applied; `session` when launched from Search, which then closes. */
export const openQuickAddAtom = atom(null, (get, set, {request, session}: {request: EditorRequest; session: QuickAddSession | null}) => {
    const modals = get(GlobalAtoms.modalsAtom)
    if (!modals) return
    set(GlobalAtoms.quickAddSessionAtom, session)
    set(GlobalAtoms.quickAddExitAtom, null)
    // A draft started on an earlier day is aimed at today's note.
    const today = dailyNotePath(dailyConfigOf(get(GlobalAtoms.indexAtom)))
    const draft = get(appendDraftAtom)
    if (request.kind === "edit") {
        set(GlobalAtoms.editSessionAtom, request.state)
    } else if (request.kind === "link") {
        // Link names are case-insensitive, like Obsidian's links and the graph's page keys.
        if (draft && draft.parentName?.toLowerCase() === request.name.toLowerCase()) {
            set(appendDraftAtom, {...draft, sourcePath: today})
        } else {
            if (draft) void trashSessionAttachments(get(GlobalAtoms.appAtom), draft.attachments)
            set(appendDraftAtom, newAppendState(today, request.name))
        }
    } else {
        set(appendDraftAtom, draft ? {...draft, sourcePath: today} : newAppendState(today))
    }
    if (get(GlobalAtoms.currentModalAtom) === modals.search) modals.search.close()
    modals.quickAdd.open()
})

/** Closes Quick Add, recording why for `quickAddClosedAtom`. */
export const leaveQuickAddAtom = atom(null, (get, set, exit: QuickAddExit) => {
    set(GlobalAtoms.quickAddExitAtom, exit)
    get(GlobalAtoms.modalsAtom)?.quickAdd.close()
})

/** Quick Add's `onClose`: back to the launching Search view with its query focused and selected; opened directly,
 *  only a save goes on to the Search modal (which selects the written row). */
export const quickAddClosedAtom = atom(null, (get, set) => {
    const exit = get(GlobalAtoms.quickAddExitAtom) ?? {kind: "dismissed"}
    const session = get(GlobalAtoms.quickAddSessionAtom)
    set(GlobalAtoms.quickAddExitAtom, null)
    set(GlobalAtoms.quickAddSessionAtom, null)
    const modals = get(GlobalAtoms.modalsAtom)
    if (!modals) return
    if (session) {
        set(GlobalAtoms.selectQueryAtom, {view: session.view})
        if (!session.reopenSearch) return
        set(GlobalAtoms.lastSearchAtom, {query: session.query})
        if (exit.kind !== "saved" && session.selected.length > 0) {
            set(GlobalAtoms.pendingSelectAtom, {view: session.view, targets: session.selected, flash: false})
        }
    } else {
        if (exit.kind !== "saved") return
        set(GlobalAtoms.selectQueryAtom, {view: "modal"})
    }
    // Obsidian is still closing Quick Add; open Search once it has finished.
    window.setTimeout(() => modals.search.open(), 0)
})
