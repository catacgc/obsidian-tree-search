// Result-row gestures: Alt+click opens Alt-Edit (desktop, editor mode); a long-press selects the
// row and opens the action panel (mobile, every view with the action footer).
import type React from "react";
import {useRef} from "react";
import {useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {Platform} from "obsidian";
import {SearchViewMolecule} from "../react-context/state";
import {EditorMolecule} from "../editor/EditorMolecule";
import type {TreeNode} from "./SearchViewFlatten";

const LONG_PRESS_MS = 500

type RowGestureHandlers = Pick<React.HTMLAttributes<HTMLDivElement>,
    "onClickCapture" | "onContextMenu" | "onTouchStart" | "onTouchMove" | "onTouchEnd" | "onTouchCancel">

export function useRowGestures(row: TreeNode, editable: boolean): RowGestureHandlers {
    const {allowEditing, searchVisibleAtom, selectedLineAtom, openActionPanelAtom} = useMolecule(SearchViewMolecule)
    const {openEditAtom} = useMolecule(EditorMolecule)
    const openEdit = useSetAtom(openEditAtom)
    const hasFooter = useAtomValue(searchVisibleAtom)
    const setSelected = useSetAtom(selectedLineAtom)
    const openActionPanel = useSetAtom(openActionPanelAtom)
    const timer = useRef<number | null>(null)
    const suppressClick = useRef(false)

    const clearTimer = () => {
        if (timer.current !== null) window.clearTimeout(timer.current)
        timer.current = null
    }

    const handlers: RowGestureHandlers = {
        onClickCapture: ev => {
            if (suppressClick.current) {
                // The click that ends a long-press must not also select/open the row.
                suppressClick.current = false
                ev.preventDefault()
                ev.stopPropagation()
                return
            }
            if (allowEditing && ev.altKey && editable) {
                ev.preventDefault()
                ev.stopPropagation()
                void openEdit(row)
            }
        },
    }

    if (Platform.isMobile && hasFooter) {
        handlers.onTouchStart = () => {
            clearTimer()
            timer.current = window.setTimeout(() => {
                timer.current = null
                suppressClick.current = true
                setSelected(row.index)
                openActionPanel()
            }, LONG_PRESS_MS)
        }
        handlers.onTouchMove = clearTimer
        handlers.onTouchEnd = clearTimer
        handlers.onTouchCancel = clearTimer
        // Android fires contextmenu on long-press; keep the system menu and link preview out of it.
        handlers.onContextMenu = ev => ev.preventDefault()
    }

    return handlers
}
