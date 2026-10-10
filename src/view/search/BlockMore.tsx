import React from "react";
import {useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import type {BlockFooter} from "@mdtree/core";
import {SearchViewMolecule} from "../react-context/state";
import {GuideLines} from "../SearchTreeNode";

/** Tree "+N more" footer under a compacted list (blockFooters); expands its hidden children. */
export function BlockMoreFooter({footer}: {footer: BlockFooter}) {
    const {showCompactedAtom} = useMolecule(SearchViewMolecule)
    const show = useSetAtom(showCompactedAtom)
    return <div className="ts-list-line ts-block-more-line" style={{'--indent-level': footer.indent + 1} as React.CSSProperties}>
        <div className="ts-list-guides"><GuideLines indent={footer.indent + 1}/></div>
        <div role="button" tabIndex={0} className="ts-block-more"
             onClick={ev => {
                 ev.stopPropagation()
                 show(footer.listIndex)
             }}
             onKeyDown={ev => {
                 if (ev.key !== "Enter" && ev.key !== " ") return
                 ev.preventDefault()
                 ev.stopPropagation()
                 show(footer.listIndex)
             }}>+{footer.hidden} more</div>
    </div>
}
