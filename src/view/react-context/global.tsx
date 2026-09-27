import {NotesGraph} from "@mdtree/core";
import {App, Modal, TFile} from "obsidian";
import {getDefaultStore, atom} from "jotai";

const appAtom = atom<App>(null as any as App)
const graphAtom = atom<NotesGraph>(new NotesGraph())
const graphVersionAtom = atom(0)
const isGraphLoadingAtom = atom(false)
const currentModalAtom = atom<Modal | null>(null)
const pinAtom = atom<boolean>(false)
const parserTypeAtom = atom<"native-wasm" | "typescript">("typescript")

export type SearchViewMode = "tree" | "timeline"

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
    // Tree/Timeline presentation shared by the Search modal and Search pane.
    // In-memory only: resets to "tree" on plugin reload.
    searchViewModeAtom: atom<SearchViewMode>("tree")
}
