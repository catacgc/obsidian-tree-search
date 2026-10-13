// The cut drawer above the footer (Search modal and pane): the rows cut with ⌘X, shared by both views, and their
// bulk actions. Div buttons, like the footer's: Obsidian's <button> chrome breaks the layout.
import {useAtom, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {Platform} from "obsidian";
import {GlobalAtoms} from "../react-context/global";
import {SearchViewMolecule} from "../react-context/state";
import {EditorMolecule} from "../editor/EditorMolecule";
import {basenameOf} from "../editor/draft";
import {cutKeyOf, removeCut} from "./cut-drawer";

export const CutDrawer = () => {
    const {allowEditing, startDrawerMoveAtom} = useMolecule(SearchViewMolecule)
    const {archiveDrawerAtom} = useMolecule(EditorMolecule)
    const [items, setItems] = useAtom(GlobalAtoms.cutDrawerAtom)
    const startDrawerMove = useSetAtom(startDrawerMoveAtom)
    const archiveDrawer = useSetAtom(archiveDrawerAtom)
    if (!allowEditing || items.length === 0) return null

    return <div className={`ts-cut-drawer ${Platform.isPhone ? "is-phone" : ""}`}>
        <div className="ts-cut-drawer-head">
            <span className="ts-cut-drawer-title">Cut · {items.length}</span>
            <div role="button" tabIndex={-1} className="ts-cut-drawer-action" onClick={() => startDrawerMove()}>Move under…</div>
            <div role="button" tabIndex={-1} className="ts-cut-drawer-action" onClick={() => void archiveDrawer()}>Archive</div>
            <div role="button" tabIndex={-1} className="ts-cut-drawer-action" onClick={() => setItems([])}>Clear</div>
        </div>
        <div className="ts-cut-drawer-list">
            {items.map(ref => <div key={cutKeyOf(ref.node)} className="ts-cut-drawer-item" title={ref.node.location.path}>
                <span className="ts-cut-drawer-label">{ref.label}</span>
                {ref.node.nodeType === "text" && <span className="ts-cut-drawer-path">{basenameOf(ref.node.location.path)}</span>}
                <div role="button" tabIndex={-1} aria-label="Take out of drawer" className="ts-cut-drawer-remove"
                     onClick={() => setItems(removeCut(items, [ref]))}>×</div>
            </div>)}
        </div>
    </div>
}
