import {atom, useAtomValue, type Getter} from "jotai";
import {Notice} from "obsidian";
import {highlightLine, archiveLine, unarchiveLine, archivePage, unarchivePage, insertHere} from "../../obsidian-utils";
import {getTreeNodeActions, openTargetOf, raycastActionOf, RaycastAction, webEnterAction} from "../node-actions";
import {molecule} from "bunshi";
import {GlobalAppMolecule, SearchViewMolecule, SearchViewScope} from "./state";
import {GlobalAtoms} from "./global";
import {separatorAtom, settingsAtom} from "./settings";
import {EditorMolecule} from "../editor/EditorMolecule";
import {isPatchable} from "../search/chain";
import {hasExploreRows, rowIntent, type RowIntent} from "../search/row-intent";
import type {TreeNode} from "../search/SearchViewFlatten";


export const ActionsMolecule = molecule((mol, scope) => {
    const scp = scope(SearchViewScope)
    const {selectedNodeAtom, enterRowAtom, selectEnterRowAtom, hoveredLineAtom, selectedLineAtom, outlineAtom, openOutlineAtom, newLineSelectedAtom, openAddToAtom, chainAtom, outlineDirtyAtom} = mol(SearchViewMolecule)
    const { appAtom } = mol(GlobalAppMolecule)
    const { editAtom, editTaskAtom } = mol(EditorMolecule)

    /**
     * Close the currently opened modal
     */
    const closeModalAtom = atom(null, (get, set) => {
        const modal = get(GlobalAtoms.currentModalAtom)
        if (modal) modal.close()
    })

    /** What Enter (`via` "key") or a click on the selected row ("pointer") does to `row` (rowIntent); null outside
     *  views with editor mode, during a reparent, or for no row. */
    const intentOf = (get: Getter, row: TreeNode | null, via: "key" | "pointer"): RowIntent | null => {
        if (!scp.allowEditing || get(chainAtom) !== null || !row || row.archiveRow) return null
        const app = get(appAtom)
        const node = row.node
        return rowIntent(node, {
            mode: get(outlineAtom)?.mode ?? null,
            via,
            hasChildren: node.nodeType === "text" && hasExploreRows(get(GlobalAtoms.graphAtom), node, get(separatorAtom)),
            web: app ? webEnterAction(getTreeNodeActions(app, row, "default")) : null,
        })
    }

    /** What Enter does to the row it acts on (enterRowAtom): the footer names it. */
    const enterIntentAtom = atom(get => intentOf(get, get(enterRowAtom), "key"))

    /** Enter / a second click on the selected row in views with editor mode. The New line row opens a new line; any
     *  other row runs its rowIntent. A web URL, and a copied snippet, close the modal unless the outline has unsaved
     *  edits. False for a row with no intent of its own (`default`): the caller runs the row's default action. */
    const openRowAtom = atom(null, async (get, set, via: "key" | "pointer" = "key"): Promise<boolean> => {
        if (!scp.allowEditing || get(chainAtom) !== null) return false
        const o = get(outlineAtom)
        if (get(newLineSelectedAtom)) {
            set(openAddToAtom)
            return true
        }
        const row = get(selectedNodeAtom)
        const intent = intentOf(get, row, via)
        if (!row || !intent) return false
        switch (intent.kind) {
            case "default": return false
            case "edit": await set(editAtom, row, o?.mode ?? "explore"); return true
            case "explore": return set(openOutlineAtom, {kind: "row", row, mode: "explore"})
            case "toggleTask": await set(editTaskAtom, row.node, {kind: "done", done: intent.done}); return true
            case "browse": await executeAction(intent.action); break
            case "copy": await executeAction({type: "copy", text: intent.text, title: "", icon: ""}); break
        }
        if (!get(outlineDirtyAtom)) set(closeModalAtom)
        return true
    })

    const selectHoveredLineAtom = atom(null, async (get, set) => {
        const newLine = get(hoveredLineAtom)
        const oldLine = get(selectedLineAtom)

        // A second click opens the row: in views with editor mode, the outline editor (openRowAtom), else (or when
        // that doesn't apply) it reveals the row in Obsidian.
        if (newLine == oldLine) {
            if (await set(openRowAtom, "pointer")) return
            await set(highlightSelectedItemAtom)
        }
        set(selectedLineAtom, newLine)
    })

    /**
     * Open the selected node (else the first row: enterRowAtom) from the current view in the editor
     */
    const highlightSelectedItemAtom = atom(null, async (get, set) => {
        set(selectEnterRowAtom)
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

    /** Enter: the selected row's default action. Views with editor mode open the row in the outline editor instead
     *  (openRowAtom), and with nothing selected (the plain search or the outline editor) run Add to. Elsewhere,
     *  nothing selected acts on the first row (enterRowAtom). */
    const handleDefaultActionAtom = atom(null, async (get, set) => {
        if (scp.allowEditing && get(chainAtom) === null && get(selectedNodeAtom) === null && !get(newLineSelectedAtom)) {
            set(openAddToAtom)
            return
        }
        set(selectEnterRowAtom)
        if (await set(openRowAtom)) return
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

    /** The actions of the row Enter acts on (enterRowAtom): the footer describes Enter with them. */
    const enterRowActionsAtom = atom((get) => {
        const node = get(enterRowAtom)
        const app = get(appAtom)
        if (!node || !app) return []
        return getTreeNodeActions(app, node, scp.isQuickLink ? "insertLink" : "default")
    })

    /** Runs a row action. `inObsidian`: the action panel's "… in Obsidian" items, which open a note in Obsidian even
     *  where Open shows it in the outline editor. */
    const executeActionAtom = atom(null, async (get, set, action: RaycastAction, inObsidian: boolean = false) => {
        // Views with editor mode open a page row's, header row's or text row's note or heading link in the outline
        // editor instead of in Obsidian.
        const target = openTargetOf(action)
        const sel = get(selectedNodeAtom)
        if (!inObsidian && target !== null && sel && !sel.archiveRow && isPatchable(sel.node) && set(openOutlineAtom, {kind: "link", link: target, mode: "explore"})) return
        if (action.type === "browse" && action.keepOpen && action.location) {
            const app = get(appAtom)
            const raycastaction = raycastActionOf(action)
            if (raycastaction === "archivePage") {
                await archivePage(app, action.location.path, get(settingsAtom).archiveTag)
            } else if (raycastaction === "unarchivePage") {
                await unarchivePage(app, action.location.path, get(settingsAtom).archiveTag)
            } else if (raycastaction === "archive") {
                await archiveLine(app, action.location, get(settingsAtom).archiveTag)
            } else {
                await unarchiveLine(app, action.location, get(settingsAtom).archiveTag)
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
        enterRowActionsAtom,
        enterIntentAtom,
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

