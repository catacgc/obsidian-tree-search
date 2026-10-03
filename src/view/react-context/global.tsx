import {NotesGraph} from "@mdtree/core";
import {App, Modal, TFile} from "obsidian";
import {getDefaultStore, atom} from "jotai";
import type {IndexedTree} from "../../indexing/indexed-tree";
import type {EditorState} from "../editor/EditorMolecule";
import type {RowTarget} from "../search/select-target";
import type {QuickAddExit, QuickAddSession} from "./quick-add-flow";

const appAtom = atom<App>(null as any as App)
const graphAtom = atom<NotesGraph>(new NotesGraph())
const graphVersionAtom = atom(0)
const isGraphLoadingAtom = atom(false)
const currentModalAtom = atom<Modal | null>(null)
const pinAtom = atom<boolean>(false)
const parserTypeAtom = atom<"native-wasm" | "typescript">("typescript")

export type GlobalStore = ReturnType<typeof getDefaultStore>

export const GlobalAtoms = {
    appAtom,
    graphAtom,
    graphVersionAtom,
    isGraphLoadingAtom,
    currentModalAtom,
    pinAtom,
    parserTypeAtom,
    activeFileAtom: atom<TFile | undefined>(undefined),
    indexAtom: atom<IndexedTree | null>(null),
    /** Query the Search modal opens with. */
    lastSearchAtom: atom<{query: string}>({query: ""}),
    /** The Search and Quick Add modals, set once by main.ts. */
    modalsAtom: atom<{search: Modal; quickAdd: Modal} | null>(null),
    /** Search view that launched the open Quick Add, if any (quick-add-flow.ts). */
    quickAddSessionAtom: atom<QuickAddSession | null>(null),
    /** Why Quick Add is closing; null when it was dismissed (Escape, ✕, backdrop). */
    quickAddExitAtom: atom<QuickAddExit | null>(null),
    /** Row the view named `view` (its SearchViewScope name) selects on its next result recompute. */
    pendingSelectAtom: atom<{view: string; targets: RowTarget[]; flash: boolean} | null>(null),
    /** Search view (SearchViewScope name) that focuses its search input and selects the query next; a fresh object per request. */
    selectQueryAtom: atom<{view: string} | null>(null),
    /** Quick Add's transient Alt-Edit session, shown over the Append draft; discarded when Quick Add closes. */
    editSessionAtom: atom<EditorState | null>(null),
}
