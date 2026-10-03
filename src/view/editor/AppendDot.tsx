import React, {useState} from "react";
import {useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {CirclePlus} from "lucide-react";
import {EditorMolecule} from "./EditorMolecule";
import type {AppendTarget} from "./row-editing";

/** The ⊕ at the bottom edge of a page group's last row; opens Append for that page. */
export function AppendDot({target}: { target: AppendTarget }) {
    const {openAppendAtom} = useMolecule(EditorMolecule)
    const openAppend = useSetAtom(openAppendAtom)
    const [hover, setHover] = useState(false)

    return <div
        className={`ts-append-dot ${hover ? "is-hover" : ""}`}
        aria-label={`Append under [[${target.parentName}]]`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={ev => {
            ev.preventDefault()
            ev.stopPropagation()
            openAppend(target.parentName)
        }}
    >
        {hover && <CirclePlus size={16}/>}
    </div>
}
