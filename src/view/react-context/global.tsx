import { NotesGraph } from "../../graph";
import { App, Modal, TFile } from "obsidian";
import { getDefaultStore, atom, createStore } from "jotai";
import { molecule } from "bunshi";
import { atomEffect } from "jotai-effect";

export const GlobalAppMolecule = molecule(() => {
    const graphAtom = atom<NotesGraph>(new NotesGraph())
    const appAtom = atom<App>(null as any as App)
    const graphVersionAtom = atom(0)
    const isGraphLoadingAtom = atom(false)
    const currentModalAtom = atom<Modal | null>(null)
    const pinAtom = atom<boolean>(false)
    const activeFileAtom = atom<TFile | undefined>(undefined)

    const store = createStore()
    const setApp = (app: App) => {
        store.set(appAtom, app)
    }

    const activeFileEffectAtom = atomEffect((get, set) => {
        const app = get(appAtom);
        const pin = get(pinAtom);
        const activeFile = get(activeFileAtom);

        if (!app) return;

        const updateActiveFile = () => {
            if (pin && activeFile) {
                return;
            }

            const file = app.workspace.getActiveFile();
            file && set(activeFileAtom, file);
        };

        updateActiveFile();

        // Set up listener
        app.workspace.on('active-leaf-change', updateActiveFile);

        // Cleanup function
        return () => {
            app.workspace.off('active-leaf-change', updateActiveFile);
        };
    })

    return {
        random: Math.random(),
        store,
        appAtom,
        graphAtom,
        graphVersionAtom,
        isGraphLoadingAtom,
        currentModalAtom,
        pinAtom,
        activeFileAtom,
        activeFileEffectAtom,
        setApp
    }
})


export type GlobalStore = ReturnType<typeof getDefaultStore>