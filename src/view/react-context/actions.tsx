import {atom, useAtomValue} from "jotai";
import {Notice} from "obsidian";
import {highlightLine} from "../../obsidian-utils";
import {getTreeNodeActions, RaycastAction} from "../raycast/raycast-response";
import {molecule} from "bunshi";
import {GlobalAppMolecule, SearchViewMolecule, SearchViewScope} from "./state";
import {GlobalAtoms} from "./global";


export const ActionsMolecule = molecule((mol, scope) => {
    const {selectedNodeAtom, hoveredLineAtom, selectedLineAtom} = mol(SearchViewMolecule)
    const { appAtom } = mol(GlobalAppMolecule)

    /**
     * Close the currently opened modal
     */
    const closeModalAtom = atom(null, (get, set) => {
        const modal = get(GlobalAtoms.currentModalAtom)
        if (modal) {
            modal.close()
        }
    })

    const selectHoveredLineAtom = atom(null, async (get, set) => {
        const newLine = get(hoveredLineAtom)
        const oldLine = get(selectedLineAtom)

        if (newLine == oldLine) {
            await set(highlightSelectedItemAtom)
        }

        set(selectedLineAtom, newLine)
    })

    /**
     * Open the selected node from the current view in the editor
     */
    const highlightSelectedItemAtom = atom(null, async (get, set) => {

        const actions = get(selectedTreeNodeActionsAtom)
        if (actions.length == 0) return

        const highlightAction = actions.find(it => it.shortcut && it.shortcut.modifiers.includes("shift") )
        if (!highlightAction) return

        await set(executeActionAtom, highlightAction)
    })

    const copyActionAtom = atom(null, async (get, set) => {
        const actions = get(selectedTreeNodeActionsAtom)
        if (actions.length == 0) return

        const copyAction = actions.find(it => it.type == "copy")
        if (!copyAction) return

        await set(executeActionAtom, copyAction)
    })

    const insertActionAtom = atom(null, async (get, set) => {
        const actions = get(selectedTreeNodeActionsAtom)
        if (actions.length == 0) return

        const insertAction = actions.find(it => it.type == "browse" && it.url.includes("raycastaction=insert"))
        if (!insertAction) return

        await set(executeActionAtom, insertAction)
    })

    const handleDefaultActionAtom = atom(null, async (get, set) => {
        const actions = get(selectedTreeNodeActionsAtom)
        if (actions.length == 0) return

        const defaultAction = actions.find(it => it.shortcut?.key == "enter")
        if (!defaultAction) return

        await set(executeActionAtom, defaultAction)
    })


    const selectedTreeNodeActionsAtom = atom((get) => {
        const node = get(selectedNodeAtom)
        const app = get(appAtom)

        if (!node || !app) return []

        return getTreeNodeActions(app, node)
    })

    const executeActionAtom = atom(null, async (get, set, action: RaycastAction) => {
        await executeAction(action)
        set(closeModalAtom)
    })

    return {
        highlightSelectedItemAtom,
        copyActionAtom,
        insertActionAtom,
        handleDefaultActionAtom,
        selectedTreeNodeActionsAtom,
        executeActionAtom,
        selectHoveredLineAtom
    }
})


const executeAction = async (action: RaycastAction) => {
    if (action.type == "copy") {
        await navigator.clipboard.writeText(action.text)
        new Notice(`*${action.text}* copied to clipboard`);
    } else if (action.type == "browse") {
        window.open(action.url, "_blank")
    }
}

