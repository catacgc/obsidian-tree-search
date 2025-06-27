import React from "react";
import {useSetAtom} from "jotai/index";
import {useMolecule} from "bunshi/react";
import {SearchViewMolecule} from "../react-context/state";
import {ActionsMolecule} from "../react-context/actions";

export const KeyComboWrapper = ({children}: { children: React.ReactNode }) => {
    const {arrowDownAtom, arrowUpAtom} = useMolecule(SearchViewMolecule)

    const {
        copyActionAtom,
        handleDefaultActionAtom,
        highlightSelectedItemAtom,
        insertActionAtom
    } = useMolecule(ActionsMolecule)

    const arrowUp = useSetAtom(arrowUpAtom)
    const arrowDown = useSetAtom(arrowDownAtom)
    const handleDefaultAction = useSetAtom(handleDefaultActionAtom)
    const highlightSelectedItem = useSetAtom(highlightSelectedItemAtom)
    const copyAction = useSetAtom(copyActionAtom)
    const insertAction = useSetAtom(insertActionAtom)

    const handleKeyDown = async (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key == "ArrowUp") {
            arrowUp()
            event.preventDefault();
        }
        else if (event.key == "ArrowDown") {
            arrowDown()
            event.preventDefault();
        } else if (event.key == "Enter" && event.shiftKey) {
            await highlightSelectedItem()
            event.preventDefault();
        } else if (event.key == "c" && event.ctrlKey) {
            await copyAction()
            event.preventDefault();
        } else if (event.key == "Enter") {
            await handleDefaultAction()
            event.preventDefault();
        } else if (event.key == "i" && event.ctrlKey) {
            await insertAction()
            event.preventDefault();
        }
    }

    return <div
        onKeyDown={handleKeyDown}
        tabIndex={0}
        className="outline-none focus:outline-none"
    >
        {children}
    </div>
}
