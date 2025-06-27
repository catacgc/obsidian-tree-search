import {NotesGraph} from "../../graph";
import {App, Modal, TFile} from "obsidian";
import {getDefaultStore, atom} from "jotai";

const appAtom = atom<App>(null as any as App)
const graphAtom = atom<NotesGraph>(new NotesGraph())
const graphVersionAtom = atom(0)
const isGraphLoadingAtom = atom(false)
const currentModalAtom = atom<Modal | null>(null)
const pinAtom = atom<boolean>(false)

export type GlobalStore = ReturnType<typeof getDefaultStore>

export const GlobalAtoms = {
    appAtom,
    graphAtom,
    graphVersionAtom,
    isGraphLoadingAtom,
    currentModalAtom,
    pinAtom,
    activeFileAtom: atom<TFile | undefined>(undefined)
}
