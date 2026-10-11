// Editor requests. Every editor entry point (a Search view's `>` chain, ⊕, Alt+A, Alt-Edit,
// Quick Add's Alt+Enter) is applied to the Append draft or a transient Alt-Edit / prose
// session by applyEditorRequestAtom; the Search modal and pane then show the editor in place
// (SearchViewMolecule.enterEditorAtom).
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
