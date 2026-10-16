// Editor requests. Every entry point of the inline editor (Rename, Save / Rename Filter, prose) is applied to a
// transient session by applyEditorRequestAtom; the Search modal and pane then show the editor in place
// (SearchViewMolecule.enterEditorAtom).
import {atom} from "jotai"
import {GlobalAtoms} from "./global"
import type {EditorState} from "../editor/EditorMolecule"

/** A transient Rename, filter or prose session. */
export type EditorRequest = {kind: "session"; state: EditorState}

/** Applies `request` to the transient session; the single place requests change it. */
export const applyEditorRequestAtom = atom(null, (_get, set, request: EditorRequest) => {
    set(GlobalAtoms.editSessionAtom, request.state)
})
