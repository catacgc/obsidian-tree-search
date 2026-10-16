import React, {useState} from "react";
import {useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {CirclePlus} from "lucide-react";
import {SearchViewMolecule} from "../react-context/state";
import type {TreeNode} from "../search/SearchViewFlatten";
import {rowLabel} from "../search/chain";

/** The ⊕ at the bottom edge of the hovered row (a page, heading or line): opens the outline editor on the row (inside
 *  it: descends into the row). */
export function PatchDot({row}: { row: TreeNode }) {
    const {openOutlineAtom} = useMolecule(SearchViewMolecule)
    const openOutline = useSetAtom(openOutlineAtom)
    const [hover, setHover] = useState(false)

    return <div
        className={`ts-append-dot ${hover ? "is-hover" : ""}`}
        aria-label={`Edit ${rowLabel(row.node)} in the outline editor`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={ev => {
            ev.preventDefault()
            ev.stopPropagation()
            openOutline({kind: "row", row, mode: "edit"})
        }}
    >
        {hover && <CirclePlus size={16}/>}
    </div>
}
