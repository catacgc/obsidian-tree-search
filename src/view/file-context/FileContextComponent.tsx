import {openFileByName} from "../../obsidian-utils";
import {useAtom, useAtomValue, useSetAtom} from "jotai";
import SearchPage from "../SearchPage";
import {GlobalAtoms} from "../react-context/global";
import {useMolecule} from "bunshi/react";
import {GlobalAppMolecule} from "../react-context/state";
import {atomEffect} from "jotai-effect";

export const ActiveFileContext = () => {
    const activeFile = useAtomValue(GlobalAtoms.activeFileAtom);
    const app = useAtomValue(GlobalAtoms.appAtom)
    const {searchForActiveFileAtom} = useMolecule(GlobalAppMolecule)
    const searchForActiveFile = useAtomValue(searchForActiveFileAtom)

    async function openActiveFile() {
        if (app == undefined) return
        if (activeFile == undefined) return
        await openFileByName(app, activeFile.basename)
    }

    if (activeFile == undefined) return <></>

    return <SearchPage searchFn={searchForActiveFile} sectionName="Active File" maxExpand={1}></SearchPage>
}

const activeFileEffectAtom = atomEffect((get, set) => {
    const app = get(GlobalAtoms.appAtom);
    const currentPin = get(GlobalAtoms.pinAtom);
    const currentActiveFile = get(GlobalAtoms.activeFileAtom);

    if (!app) return;

    const updateActiveFile = () => {
        if (currentPin && currentActiveFile) {
            return;
        }

        const file = app.workspace.getActiveFile();
        file && set(GlobalAtoms.activeFileAtom, file);
    };

    updateActiveFile();

    // Set up listener
    app.workspace.on('active-leaf-change', updateActiveFile);

    // Cleanup function
    return () => {
        app.workspace.off('active-leaf-change', updateActiveFile);
    };
})

export const FileContextComponent = () => {
    const {searchParentsFnAtom, searchTasksAtom} = useMolecule(GlobalAppMolecule)
    const searchParentsFn = useAtomValue(searchParentsFnAtom)
    const searchTasks = useAtomValue(searchTasksAtom)
    const [pin, setPin] = useAtom(GlobalAtoms.pinAtom);
    const activeFile = useAtomValue(GlobalAtoms.activeFileAtom)

    useAtom(activeFileEffectAtom)

    return <>
        <button
            className="w-full text-center py-2 px-4 bg-obs-base-20 hover:bg-obs-base-30 border border-obs-base-40 rounded-md transition-colors duration-150"
            onClick={() => {
                setPin(!pin)
            }}
        >
            {pin ? "Unpin" : "Pin"} {activeFile?.basename}
        </button>
        <SearchPage searchFn={searchParentsFn} sectionName="Parents"/>
        <ActiveFileContext />
        <SearchPage searchFn={searchTasks} sectionName="Related Tasks"/>
    </>
}
