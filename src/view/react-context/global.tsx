import {NotesGraph} from "@mdtree/core";
import {App, Modal, TFile} from "obsidian";
import {getDefaultStore, atom} from "jotai";
import type {IndexedTree} from "../../indexing/indexed-tree";
import type {EditorState} from "../editor/EditorMolecule";
import type {RowTarget} from "../search/select-target";
import type {RowRef} from "../search/chain";
import {cutKeyOf} from "../search/cut-drawer";

const appAtom = atom<App>(null as any as App)
const graphAtom = atom<NotesGraph>(new NotesGraph())
const graphVersionAtom = atom(0)
const isGraphLoadingAtom = atom(false)
const currentModalAtom = atom<Modal | null>(null)
const pinAtom = atom<boolean>(false)
const parserTypeAtom = atom<"native-wasm" | "typescript">("typescript")
const cutDrawerAtom = atom<RowRef[]>([])

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
    /** Scope name of the view showing the editor ("modal" or "Search"); null when none. */
    editorHostAtom: atom<string | null>(null),
    /** Search view (SearchViewScope name) that starts Quick Add (chip-less patch mode) next; a fresh object per request. */
    quickAddRequestAtom: atom<{view: string} | null>(null),
    /** Row the view named `view` (its SearchViewScope name) selects on its next result recompute. */
    pendingSelectAtom: atom<{view: string; targets: RowTarget[]; flash: boolean} | null>(null),
    /** Search view (SearchViewScope name) that focuses its search input and selects the query next; a fresh object per request. */
    selectQueryAtom: atom<{view: string} | null>(null),
    /** The transient Alt-Edit or prose session, shown over the Append draft; discarded when its editor closes. */
    editSessionAtom: atom<EditorState | null>(null),
    /** The cut drawer (⌘X), shared by the Search modal and pane; lives until the plugin reloads (the store is recreated). */
    cutDrawerAtom,
    /** cutKeyOf of every drawer item, for marking cut rows. */
    cutKeysAtom: atom(get => new Set(get(cutDrawerAtom).map(r => cutKeyOf(r.node)))),
}
