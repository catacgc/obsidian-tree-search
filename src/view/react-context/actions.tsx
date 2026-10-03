import {atom, useAtomValue} from "jotai";
import {Notice} from "obsidian";
import {highlightLine, archiveLine, unarchiveLine, archivePage, unarchivePage, insertHere} from "../../obsidian-utils";
import {getTreeNodeActions, raycastActionOf, RaycastAction} from "../node-actions";
import {molecule} from "bunshi";
import {GlobalAppMolecule, SearchViewMolecule, SearchViewScope} from "./state";
import {GlobalAtoms} from "./global";
import {settingsAtom} from "./settings";
import {EditorMolecule} from "../editor/EditorMolecule";


export const ActionsMolecule = molecule((mol, scope) => {
    const scp = scope(SearchViewScope)
    const {selectedNodeAtom, hoveredLineAtom, selectedLineAtom} = mol(SearchViewMolecule)
    const { appAtom } = mol(GlobalAppMolecule)
    const { openAppendForSelectedAtom } = mol(EditorMolecule)

    /**
     * Close the currently opened modal
     */
    const closeModalAtom = atom(null, (get, set) => {
        const modal = get(GlobalAtoms.currentModalAtom)
        if (modal) modal.close()
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

    /** Runs the selected row's action whose `raycastaction` is one of `names` (e.g. archive / unarchive), if it has one. */
    const runRaycastActionAtom = atom(null, async (get, set, names: string[]) => {
        const action = get(selectedTreeNodeActionsAtom).find(a => names.includes(raycastActionOf(a) ?? ""))
        if (action) await set(executeActionAtom, action)
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

        return getTreeNodeActions(app, node, scp.isQuickLink ? "insertLink" : "default")
    })

    const executeActionAtom = atom(null, async (get, set, action: RaycastAction) => {
        // Views with editor mode open the inline Append editor for the selected row (like Alt+A)
        // instead of inserting a line in an Obsidian note; the modal stays open to host it.
        if (scp.allowEditing && raycastActionOf(action) === "insert") {
            await set(openAppendForSelectedAtom)
            return
        }
        if (action.type === "browse" && action.keepOpen && action.location) {
            const app = get(appAtom)
            const raycastaction = raycastActionOf(action)
            if (raycastaction === "archivePage") {
                await archivePage(app, action.location.path, get(settingsAtom).archiveTag)
            } else if (raycastaction === "unarchivePage") {
                await unarchivePage(app, action.location.path, get(settingsAtom).archiveTag)
            } else if (raycastaction === "archive") {
                await archiveLine(app, action.location)
            } else {
                await unarchiveLine(app, action.location)
            }
            return  // modal stays open
        }
        if (action.type === "insertLink") {
            await insertHere(get(appAtom), action.text)
            set(closeModalAtom)
            return
        }
        await executeAction(action)
        set(closeModalAtom)
    })

    return {
        highlightSelectedItemAtom,
        copyActionAtom,
        runRaycastActionAtom,
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

