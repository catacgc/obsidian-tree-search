import { openFileByName } from "../../obsidian-utils";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import SearchPage from "./SearchPage";
import { useMolecule } from "bunshi/react";
import { GlobalSearchMolecule } from "../react-context/state";
import { atomEffect } from "jotai-effect";
import { GlobalAppMolecule } from "../react-context/global";

export const ActiveFileContext = () => {
    const { activeFileAtom } = useMolecule(GlobalAppMolecule)
    const { searchForActiveFileAtom } = useMolecule(GlobalSearchMolecule)
    const searchForActiveFile = useAtomValue(searchForActiveFileAtom)
    const activeFile = useAtomValue(activeFileAtom)

    async function openActiveFile() {
        if (app == undefined) return
        if (activeFile == undefined) return
        await openFileByName(app, activeFile.basename)
    }

    if (activeFile == undefined) return <></>

    return <SearchPage searchFn={searchForActiveFile} sectionName="Active File" maxExpand={1}></SearchPage>
}



export const FileContextComponent = () => {
    const { activeFileAtom, pinAtom, activeFileEffectAtom } = useMolecule(GlobalAppMolecule)
    const { searchParentsFnAtom, searchTasksAtom } = useMolecule(GlobalSearchMolecule)
    const searchParentsFn = useAtomValue(searchParentsFnAtom)
    const searchTasks = useAtomValue(searchTasksAtom)

    const [pin, setPin] = useAtom(pinAtom);
    const activeFile = useAtomValue(activeFileAtom)

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
        <SearchPage searchFn={searchParentsFn} sectionName="Parents" />
        <ActiveFileContext />
        <SearchPage searchFn={searchTasks} sectionName="Related Tasks" />
    </>
}
