// Editor requests. Every entry point of the inline editor (Alt+A Append, Rename, Save / Rename Filter, prose) is
// applied to the Append draft or a transient Rename / filter / prose
// session by applyEditorRequestAtom; the Search modal and pane then show the editor in place
// (SearchViewMolecule.enterEditorAtom).
import {atom} from "jotai"
import {GlobalAtoms} from "./global"
import {appendDraftAtom} from "./settings"
import type {EditorState} from "../editor/EditorMolecule"
import {dailyConfigOf, newAppendState} from "../editor/draft"
import {dailyNotePath, trashSessionAttachments} from "../../editing/vault-edits"

export type EditorRequest =
    /** Keep the draft when it already appends to `name`; else replace it (trashing its pasted attachments) with a
     *  new draft prefilled `- [[name]]\n    - `. */
    | {kind: "link"; name: string}
    /** A transient Rename, filter or prose session over the draft. */
    | {kind: "session"; state: EditorState}

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
    } else if (draft && draft.parentName?.toLowerCase() === request.name.toLowerCase()) {
        // Link names are case-insensitive, like Obsidian's links and the graph's page keys.
        set(appendDraftAtom, {...draft, sourcePath: today})
    } else {
        replace(newAppendState(today, request.name))
    }
})
