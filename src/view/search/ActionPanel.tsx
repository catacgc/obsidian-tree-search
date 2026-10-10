// The action panel above the footer (⌘K, footer "Actions", mobile long-press): every action for
// the selected row and the view, with a filter. Items come from the pure `panelItems`.
import React, {useEffect, useRef, useState} from "react";
import {useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {Platform, Scope} from "obsidian";
import {
    Archive, ArrowRightLeft, CalendarArrowUp, CalendarClock, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown,
    CirclePlus, Combine, Copy, CornerDownRight, ExternalLink, FileSearch, FileText, FolderInput, ListTree, Pencil, RefreshCw,
    SquareCheck, SquarePen, TextCursorInput, Trash2,
    type LucideIcon,
} from "lucide-react";
import {GlobalAtoms} from "../react-context/global";
import {SearchViewMolecule, type ActionPanelPage} from "../react-context/state";
import {ActionsMolecule} from "../react-context/actions";
import {EditorMolecule} from "../editor/EditorMolecule";
import {deleteTargetOf} from "../editor/row-editing";
import {
    deleteConfirmText, filterPanelItems, moveUnderTargets, panelItems, SECTION_TITLES, type PanelIcon, type PanelItem,
} from "./action-panel";
import {keyParts, type KeySpec, type ShortcutId} from "./shortcuts";
import {useShortcutHandlers} from "./shortcut-handlers";
import {nodeLabel} from "./timeline-utils";

const ICONS: Record<PanelIcon, LucideIcon> = {
    link: ExternalLink, reveal: FileSearch, copy: Copy, insert: CornerDownRight, moveToFolder: FolderInput,
    archive: Archive, consolidate: Combine, done: SquareCheck, schedule: CalendarArrowUp, append: CirclePlus, edit: Pencil,
    moveUnder: ArrowRightLeft, openEditor: SquarePen, tree: ListTree, timeline: CalendarClock, expand: ChevronsUpDown,
    collapse: ChevronsDownUp, refresh: RefreshCw, patch: ChevronRight, rename: TextCursorInput, delete: Trash2,
}

/** Panel items that open the inline editor, which takes focus; after any other item focus returns to the search. */
const OPENS_EDITOR = new Set<ShortcutId>(["append", "edit", "newEditor"])

/** Keycaps for a key (hidden on mobile, which has no keyboard shortcuts). */
export const Keycaps = ({k}: {k?: KeySpec}) => {
    if (!k || Platform.isMobile) return null
    return <span className="ts-keycaps">{keyParts(k, Platform.isMacOS).map((p, i) => <kbd key={i} className="ts-keycap">{p}</kbd>)}</span>
}

/** Middle-truncates so both the start and the end of a long title stay visible. */
export function truncateMiddle(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text
    const start = Math.floor((maxLength - 1) / 2)
    return text.slice(0, start) + "…" + text.slice(text.length - (maxLength - 1 - start))
}

type ListEntry = {id: string; title: string; icon: LucideIcon; section?: string; key?: KeySpec; run: () => unknown}

export const ActionPanel = ({dockRef}: {dockRef: React.RefObject<HTMLDivElement | null>}) => {
    const {actionPanelAtom} = useMolecule(SearchViewMolecule)
    const page = useAtomValue(actionPanelAtom)
    return page ? <PanelBody page={page} dockRef={dockRef}/> : null
}

const PanelBody = ({page, dockRef}: {page: ActionPanelPage; dockRef: React.RefObject<HTMLDivElement | null>}) => {
    const {
        renderableTreeNodesAtom, selectedLineAtom, timelineActiveAtom, actualQueryAtom, focusSearchInputAtom,
        openActionPanelAtom, closeActionPanelAtom, chainAtom, searchVisibleAtom, allowEditing, allowTimeline,
    } = useMolecule(SearchViewMolecule)
    const {selectedTreeNodeActionsAtom, executeActionAtom} = useMolecule(ActionsMolecule)
    const {ownPathAtom, reparentAtom, editTaskAtom, pushChainAtom, openRenameFileAtom, deleteRowAtom} = useMolecule(EditorMolecule)
    const app = useAtomValue(GlobalAtoms.appAtom)
    const rows = useAtomValue(renderableTreeNodesAtom)
    const selectedLine = useAtomValue(selectedLineAtom)
    const timelineActive = useAtomValue(timelineActiveAtom)
    const actualQuery = useAtomValue(actualQueryAtom)
    const rowActions = useAtomValue(selectedTreeNodeActionsAtom)
    const ownPath = useAtomValue(ownPathAtom)
    const chain = useAtomValue(chainAtom)
    const focusSearch = useSetAtom(focusSearchInputAtom)
    const setSearchVisible = useSetAtom(searchVisibleAtom)
    const openPanel = useSetAtom(openActionPanelAtom)
    const closePanel = useSetAtom(closeActionPanelAtom)
    const executeAction = useSetAtom(executeActionAtom)
    const reparent = useSetAtom(reparentAtom)
    const editTask = useSetAtom(editTaskAtom)
    const pushChain = useSetAtom(pushChainAtom)
    const openRenameFile = useSetAtom(openRenameFileAtom)
    const deleteRow = useSetAtom(deleteRowAtom)
    const handlers = useShortcutHandlers()

    const rootRef = useRef<HTMLDivElement>(null)
    const filterRef = useRef<HTMLInputElement>(null)
    const [filter, setFilter] = useState("")
    const [highlight, setHighlight] = useState(0)
    const selectedPos = rows.findIndex(r => r.index === selectedLine)
    const selectedRow = selectedPos >= 0 ? rows[selectedPos] : undefined

    const close = (refocusSearch: boolean) => {
        closePanel()
        if (refocusSearch) focusSearch(n => n + 1)
    }

    const deleteTarget = page === "confirmDelete" && selectedRow ? deleteTargetOf(selectedRow, ownPath, timelineActive) : null
    const deleteText = deleteTarget && selectedRow
        ? deleteConfirmText(deleteTarget, truncateMiddle(nodeLabel(selectedRow.node), 40))
        : null

    const buildEntries = (): ListEntry[] => {
        if (page === "moveUnder") {
            return moveUnderTargets(rows, selectedPos).map(t => ({
                id: `target:${t}`, title: nodeLabel(rows[t].node), icon: FileText,
                run: () => { close(true); void reparent(selectedPos, t) },
            }))
        }
        if (page === "confirmDelete") {
            if (!deleteText || !selectedRow) return []
            return [{id: "confirmDelete", title: deleteText.action, icon: Trash2, run: () => { close(true); void deleteRow(selectedRow) }}]
        }
        const items = panelItems({
            rowActions, rows, selectedPos, allowEditing, allowTimeline, timelineActive, ownPath,
            chainMode: chain?.mode ?? null,
            resolveLink: (linkpath, sourcePath) => app?.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)?.path ?? null,
        })
        const runItem = (item: PanelItem) => {
            if (item.run.kind === "moveUnder") { setFilter(""); openPanel("moveUnder"); return }
            if (item.run.kind === "delete") { setFilter(""); openPanel("confirmDelete"); return }
            if (item.run.kind === "patch") {
                setSearchVisible(true)
                close(true)
                void pushChain()
                return
            }
            // Actions that open the inline editor leave focus to it; everything else returns to the search.
            close(!(item.run.kind === "renameFile" || item.run.kind === "shortcut" && OPENS_EDITOR.has(item.run.id)))
            if (item.run.kind === "action") void executeAction(item.run.action)
            else if (item.run.kind === "task") { if (selectedRow) void editTask(selectedRow.node, item.run.change) }
            else if (item.run.kind === "renameFile") openRenameFile(item.run.path)
            else void handlers[item.run.id](0)
        }
        return items.map(item => ({
            id: item.id, title: item.title, icon: ICONS[item.icon], key: item.key,
            section: item.section === "row" ? "row" : SECTION_TITLES[item.section],
            run: () => runItem(item),
        }))
    }
    const entries = buildEntries()

    const shown = filterPanelItems(entries, filter)
    const active = Math.min(highlight, Math.max(shown.length - 1, 0))
    useEffect(() => setHighlight(0), [filter, page])

    // A new query or a Tree/Timeline switch closes the panel (a new selection closes it via the atom).
    // Compared with the values at open, not skipped once: StrictMode runs mount effects twice.
    const openedWith = useRef({actualQuery, timelineActive})
    useEffect(() => {
        if (openedWith.current.actualQuery !== actualQuery || openedWith.current.timelineActive !== timelineActive) closePanel()
    }, [actualQuery, timelineActive])

    // Close on a pointer press outside the footer and panel.
    useEffect(() => {
        const onDown = (ev: PointerEvent) => {
            if (!dockRef.current?.contains(ev.target as Node)) closePanel()
        }
        document.addEventListener("pointerdown", onDown, true)
        return () => document.removeEventListener("pointerdown", onDown, true)
    }, [])

    // Escape is claimed through an Obsidian Scope (like the inline editor) so it closes the panel,
    // not the modal. Pushed only while focus is inside the panel.
    const scopeRef = useRef<Scope | null>(null)
    const escapeRef = useRef<() => void>(() => {})
    escapeRef.current = () => {
        if (page !== "main") { setFilter(""); openPanel("main") }
        else close(true)
    }
    const pushScope = () => {
        if (scopeRef.current || !app) return
        const scope = new Scope(app.scope)
        scope.register([], "Escape", () => { escapeRef.current(); return false })
        app.keymap.pushScope(scope)
        scopeRef.current = scope
    }
    const popScope = () => {
        if (!scopeRef.current || !app) return
        app.keymap.popScope(scopeRef.current)
        scopeRef.current = null
    }
    useEffect(() => popScope, [])

    // pushScope is also called directly: StrictMode's mount/cleanup/mount pops the scope that the
    // first focus pushed, and re-focusing an already-focused field fires no focus event.
    useEffect(() => {
        if (Platform.isMobile) return
        filterRef.current?.focus({preventScroll: true})
        pushScope()
    }, [page])

    const onKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
        const plain = !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey
        if (!plain) return  // ⌘K and the ⌥ shortcuts bubble to KeyComboWrapper
        if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
            ev.preventDefault()
            ev.stopPropagation()
            if (shown.length > 0) setHighlight((active + (ev.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length)
        } else if (ev.key === "Enter") {
            ev.preventDefault()
            ev.stopPropagation()
            shown[active]?.run()
        } else if (ev.key !== "Escape") {
            // Typing filters; keep single-key shortcuts out of it.
            ev.stopPropagation()
        }
    }

    const title = page === "moveUnder"
        ? `Move ${truncateMiddle(selectedRow ? nodeLabel(selectedRow.node) : "", 40)} under…`
        : page === "confirmDelete" ? deleteText?.title ?? null
        : selectedRow ? truncateMiddle(nodeLabel(selectedRow.node), 60) : null

    let lastSection: string | undefined
    return <div
        ref={rootRef}
        className={`ts-action-panel ${Platform.isPhone ? "is-phone" : ""}`}
        onFocus={pushScope}
        onBlur={ev => { if (!rootRef.current?.contains(ev.relatedTarget as Node | null)) popScope() }}
    >
        {title !== null && <div className="ts-action-panel-title">
            {page !== "main" && <div role="button" className="ts-action-panel-back" aria-label="Back"
                                          onClick={() => { setFilter(""); openPanel("main") }}><ChevronLeft size={14}/></div>}
            <span>{title}</span>
        </div>}
        <div className="ts-action-panel-list" role="listbox">
            {shown.length === 0 && <div className="ts-action-panel-empty">No matching actions</div>}
            {shown.map((entry, i) => {
                const header = entry.section && entry.section !== "row" && entry.section !== lastSection ? entry.section : null
                const divider = i > 0 && entry.section !== lastSection
                lastSection = entry.section
                const Icon = entry.icon
                return <React.Fragment key={entry.id}>
                    {divider && <div className="ts-action-panel-divider"/>}
                    {header && <div className="ts-action-panel-section">{header}</div>}
                    <div
                        role="option"
                        aria-selected={i === active}
                        className={`ts-action-panel-item ${i === active ? "is-selected" : ""}`}
                        onPointerMove={() => { if (i !== active) setHighlight(i) }}
                        onClick={ev => { ev.stopPropagation(); entry.run() }}
                    >
                        <Icon size={16} className="ts-action-panel-icon"/>
                        <span className="ts-action-panel-label">{entry.title}</span>
                        <Keycaps k={entry.key}/>
                    </div>
                </React.Fragment>
            })}
        </div>
        <input
            ref={filterRef}
            type="text"
            spellCheck={false}
            className="ts-action-panel-filter"
            placeholder={page === "moveUnder" ? "Search for a note…" : "Search for actions…"}
            value={filter}
            onChange={ev => setFilter(ev.target.value)}
            onKeyDown={onKeyDown}
        />
    </div>
}
