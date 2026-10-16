import {TreeNode} from '../search/SearchViewFlatten'
import {advancedSearch, flattenTasks, ResultNode, searchIndex, searchParents, parseQuery, linkTargetTree, type QueryExpr, type ParsedNode, partitionArchived, extractArchiveReveal, suggestAt, type Suggestion, parseDuration, flattenIndex, defaultVisibility, blockFooters, pruneToRecency, openLinkAt, noteBody, headingBody, filterOutline} from '@mdtree/core'
import {atom, useAtomValue, type Getter, type Setter} from 'jotai'
import {findTargetRow, revealRow, rowTargets, type RowTarget} from '../search/select-target'
import {expandFilterRefs, filterSuggestionsAt, toggleFilterPill} from '../search/search-filter'
import {buildTimelineRows, tagOutlineParents} from '../search/timeline-utils'
import {addToPlan, chainPrefill, chainResults, dirtyBodyKeys, isMovable, isPatchable, linksTo, patchPath, reparentLabel, rowLabel, type BodyRef, type ChainState, type NoteBody, type RowRef} from '../search/chain'
import {crumbKey, extendPath, isPinned, linkCrumbs, newLineLabel, nextLineEditId, rootFor, rootKey, rootOf, TODAY_LABEL, type LineEdit, type OutlineRoot, type OutlineState, type OutlineTarget, type PaneState} from '../search/outline'
import {dailyNotePath, trashSessionAttachments, type EditorAttachment} from '../../editing/vault-edits'
import {toggleCut} from '../search/cut-drawer'
import {basenameOf, dailyConfigOf, searchModalTitle} from '../editor/draft'
import {dragInfo, INLINE_LINK_REFUSAL, treeParentPos} from '../editor/row-editing'

type SearchQuery = { query: string; file?: string; heading?: string }
import {createScope, molecule} from "bunshi";
import {App, Notice, Platform} from "obsidian";
import {GlobalAtoms} from "./global";
import {searchFiltersAtom, searchViewModesAtom, separatorAtom, settingsAtom, type SearchFilter, type SearchViewMode} from "./settings";
import {atomWithDefault} from "jotai/utils";
import {withAtomEffect} from "jotai-effect";

export type SearchResultsState = {
    visibleNodes: TreeNode[]
    renderableNodes: TreeNode[]
    hasMore: boolean
    totalVisible: number
    totalNodes: number
}

export type SearchViewState = {
    searchResults: SearchResultsState
    isLoading: boolean
    showSearch: boolean
    version: number
    isQuickLink: boolean
    isModal: boolean
    scopeName: { name: string, instance: number }
}

export type SearchQueryBuilderBase = {
    viewType: "activeFile" | "parents" | "tasks" | "modal"
}

export type ModalQuery = {
    viewType: "modal"
}

export type SearchQueryBuilder = SearchQueryBuilderBase & (ModalQuery)

export const GlobalAppScope = createScope<{
    obsidianApp: App
}>({
    obsidianApp: null as any as App
})

export const SearchViewScope = createScope({
    name: "default",
    isQuickLink: false,
    showSearch: true,
    isModal: true,
    allowTimeline: false,
    allowEditing: false
})

export type RecencyWindow = "all" | "7d" | "30d" | "1y"
/** `selectedLineAtom`'s value while the outline editor's trailing New line row is selected. */
export const NEW_LINE_ROW = -2
export const RECENCY_WINDOWS: RecencyWindow[] = ["all", "7d", "30d", "1y"]
/** The action panel's list: the main actions or the Delete confirmation. */
export type ActionPanelPage = "main" | "confirmDelete"

export const GlobalAppMolecule = molecule((_, scope) => {

    const searchForActiveFileAtom = atom((get) => {
        const graph = get(GlobalAtoms.graphAtom)
        const activeFile = get(GlobalAtoms.activeFileAtom)
        const separator = get(separatorAtom)

        return (query: string) => {
            console.debug("Search again for active file", get(GlobalAtoms.graphVersionAtom), activeFile?.name)

            if (activeFile === undefined) {
                return []
            }

            return advancedSearch(
                graph,
                `[[${activeFile.basename}]]`.toLowerCase(),
                query,
                separator
            )
        }
    })

    const searchParentsFnAtom = atom((get) => {
        const graph = get(GlobalAtoms.graphAtom)
        const activeFile = get(GlobalAtoms.activeFileAtom)

        return (q: string) => {
            if (activeFile === undefined) {
                return []
            }

            return searchParents(graph, activeFile.basename)
        }
    })

    const searchTasksAtom = atom((get) => {
        const graph = get(GlobalAtoms.graphAtom)
        const activeFile = get(GlobalAtoms.activeFileAtom)
        const separator = get(separatorAtom)

        return (query: string) => {
            if (activeFile === undefined) {
                return []
            }

            const searchResults = advancedSearch(
                graph,
                `[[${activeFile.basename}]]`.toLowerCase(),
                query,
                separator
            )

            return flattenTasks(searchResults)
        }
    })

    return {
        appAtom: GlobalAtoms.appAtom,
        isGraphLoadingAtom: GlobalAtoms.isGraphLoadingAtom,
        searchForActiveFileAtom,
        searchParentsFnAtom,
        searchTasksAtom,
        lastSearchAtom: GlobalAtoms.lastSearchAtom
    }
})

/** The editor's link list without a parent and no `[[` open: the outline of today's daily note. */
export const DAILY_OUTLINE_QUERY = 'outline:":daily" is:page'

/** The editor's link list while no `[[` is open: the full tree of the outline's note nearest the caret (caretNote)
 *  as `[[P]]`; else today's daily outline. A name with `[` or `]` can't be written as a link, so it counts as none. */
export const quickAddDefaultQuery = (parentName: string | undefined): string =>
    parentName && !/[[\]]/.test(parentName) ? `[[${parentName}]]` : DAILY_OUTLINE_QUERY

export const SearchModalMolecule = molecule((mol, scope) => {
    const scp = scope(SearchViewScope)
    const searchMol = mol(SearchViewMolecule)

    const searchResultsAtom = atom<ResultNode[]>([])

    const searchResultsComputeAtom = withAtomEffect(searchResultsAtom, (get, set) => {
        get(GlobalAtoms.graphVersionAtom)  // re-run on mutable graph updates from refreshPage
        get(searchMol.actualQueryAtom)
        // The reparent chain (`<`) and the outline editor replace the search with their own rows.
        if (get(searchMol.chainAtom)) {
            set(searchMol.refreshChainResultsAtom)
            return
        }
        if (get(searchMol.outlineAtom)) {
            set(searchMol.refreshOutlineResultsAtom)
            return
        }
        const graph = get(GlobalAtoms.graphAtom)
        const separator = get(separatorAtom)
        const options = get(GlobalAtoms.indexAtom)?.searchOptions()
        const searchText = get(searchMol.searchTextAtom)

        if (scp.isQuickLink) {
            // Insert Link offers only link targets: notes and headers whose own name/alias/heading
            // matches the query, archived rows hidden. Its input is typed without `[[`.
            set(searchMol.updateSearchResultsAtom, linkTargetTree(graph, searchText, separator), 0)
            return
        }

        const searchResults = searchIndex(graph, searchText, separator, options)

        // `is:archived` reveals (rather than hides) archived rows; its presence
        // in the query flips partitioning from drop-with-count to keep-and-grey.
        const { reveal } = extractArchiveReveal(parseQuery(searchText, separator))
        const { visible, archivedCount } = partitionArchived(searchResults, reveal)
        set(searchMol.updateSearchResultsAtom, visible, archivedCount)
    })

    return { searchResultsComputeAtom }
})

export const SearchViewMolecule = molecule((mol, scope) => {
    const scp = scope(SearchViewScope)

    const instance = Math.random()

    const { lastSearchAtom } = mol(GlobalAppMolecule)

    const searchQueryAtom = atomWithDefault<SearchQuery>(get =>
        scp.isModal ? get(lastSearchAtom) : {query: ""})

    const actualQueryAtom = atom<string>(get => get(searchQueryAtom).query)
    /** The query as searched: `:Name` filter references expanded (expandFilterRefs). The input shows actualQueryAtom. */
    const searchTextAtom = atom<string>(get => expandFilterRefs(get(actualQueryAtom), get(searchFiltersAtom), get(separatorAtom)))
    const selectedLineValueAtom = atom(-1)
    /** Row to re-find on every recompute while the query is unchanged (a save's follow-up reindexes, a modal's mount-time rebuild); any user selection drops it. */
    const selectAnchorAtom = atom<{targets: RowTarget[]; flash: boolean; query: string} | null>(null)
    const selectedLineAtom = atom(get => get(selectedLineValueAtom), (_get, set, line: number) => {
        set(selectAnchorAtom, null)
        set(selectedLineValueAtom, line)
    })
    const chainValueAtom = atom<ChainState | null>(null)
    /** The row selected when the chain started, reselected when leaving it returns to the search (leaveChain). */
    const chainReturnAtom = atom<RowTarget[]>([])
    /** Search's reparent (`<`) chain; null when searching normally. Starting one remembers the selected row. */
    const chainAtom = atom(get => get(chainValueAtom), (get, set, next: ChainState | null) => {
        if (get(chainValueAtom) === null && next !== null) {
            const sel = get(selectedNodeAtom)
            set(chainReturnAtom, sel && !sel.archiveRow ? rowTargets(sel) : [])
        }
        set(chainValueAtom, next)
    })

    // ── Outline editor state (docs/superpowers/specs/2026-10-15-outline-editor-design.md) ──
    /** The outline editor: its crumbs, the search it returns to and its pins; null while the view searches. */
    const outlineAtom = atom<OutlineState | null>(null)
    /** The open line editor: an edited row, or the New line row. */
    const lineEditAtom = atom<LineEdit | null>(null)
    /** The view lists its trailing Add to row: in the outline editor while its line editor isn't on the new line;
     *  in the plain search of an editable view, outside a reparent. */
    const newLineShown = (get: Getter) => {
        if (!scp.allowEditing) return false
        return get(outlineAtom) !== null ? get(lineEditAtom)?.row !== null : get(chainAtom) === null && !get(editorOpenAtom)
    }
    /** The Add to row is listed and selected. */
    const newLineSelectedAtom = atom(get => newLineShown(get) && get(selectedLineAtom) === NEW_LINE_ROW)
    const newLineShownAtom = atom(get => newLineShown(get))
    /** Content-pane buffers by BodyRef key; they live until the outline's root changes or it closes. */
    const outlineBodiesAtom = atom<Record<string, NoteBody>>({})
    /** Files pasted or dropped into the content pane, renamed by alias on save and trashed on discard. */
    const bodyAttachmentsAtom = atom<EditorAttachment[]>([])
    /** Set when unsaved edits refused a leave; repeating it then discards them. Reset by an edit and by a save. */
    const discardArmedAtom = atom(false)
    const paneAtom = atom<PaneState>({size: "normal", closedKey: null})
    /** The next results select their first row (a filter crumb was just added). */
    const selectFirstOnceAtom = atom(false)
    /** Row index that is flashing (just saved); cleared by the view after the animation. */
    const flashLineAtom = atom<number | null>(null)
    const searchVisibleAtom = atom(scp.showSearch)
    const hoveredLineAtom = atom(0)
    const treeNodesAtom = atom<TreeNode[]>([])

    const pageSizeAtom = atom(50)
    const pagesAtom = atom(1)

    // Combined derived atom to avoid multiple cascading updates
    const searchResultsStateAtom = atom<SearchResultsState>((get) => {
        const treeNodes = get(treeNodesAtom)
        const pageSize = get(pageSizeAtom)
        const pages = get(pagesAtom)

        const visibleNodes = treeNodes.filter(node => node.visible)
        const renderableNodes = visibleNodes.slice(0, pages * pageSize)
        const hasMore = visibleNodes.length > pageSize * pages

        return {
            visibleNodes,
            renderableNodes,
            hasMore,
            totalVisible: visibleNodes.length,
            totalNodes: treeNodes.length
        }
    })

    // Combined view state atom to eliminate multiple subscriptions
    const searchViewStateAtom = atom<SearchViewState>((get) => {
        const searchResults = get(searchResultsStateAtom)
        const isLoading = get(GlobalAtoms.isGraphLoadingAtom)
        const showSearch = get(searchVisibleAtom)
        const version = get(GlobalAtoms.graphVersionAtom)

        return {
            searchResults,
            isLoading,
            showSearch,
            version,
            isQuickLink: scp.isQuickLink,
            isModal: scp.isModal,
            scopeName: { name: scp.name, instance: instance }
        }
    })

    // Keep individual atoms for backward compatibility
    const visibleNodesAtom = atom((get) => get(searchResultsStateAtom).visibleNodes)
    const renderableTreeNodesAtom = atom((get) => get(searchResultsStateAtom).renderableNodes)
    const hasMoreTreeNodesAtom = atom((get) => get(searchResultsStateAtom).hasMore)

    const searchPlaceholderAtom = atom((get) => {
        const chain = get(chainAtom)
        if (chain?.mode === "reparent") return `Move ${reparentLabel(chain.children)} under…`
        if (get(outlineAtom)) return "Filter — Enter adds the filter, Escape goes back to the search"
        const { totalNodes } = get(searchResultsStateAtom)
        const graph = get(GlobalAtoms.graphAtom)
        if (totalNodes > 0) {
            return `Search ${totalNodes} nodes`
        }

        return `Search ${graph.order} nodes and ${graph.size} edges`
    })

    /** Today's daily note basename (the Today crumb's note). */
    const dailyNameOf = (get: Getter) => basenameOf(dailyNotePath(dailyConfigOf(get(GlobalAtoms.indexAtom))))

    /** What a content pane edits for `node` (null: today's daily note): a note's body, the text under a heading in its
     *  page's note, a line's file's body; null without a markdown file. */
    const bodyRefOf = (get: Getter, node: ParsedNode | null): BodyRef | null => {
        const app = get(GlobalAtoms.appAtom)
        const file = node === null ? app.vault.getFileByPath(dailyNotePath(dailyConfigOf(get(GlobalAtoms.indexAtom))))
            : node.nodeType === "page" || node.nodeType === "header" ? app.metadataCache.getFirstLinkpathDest(node.page, "")
            : node.nodeType === "text" ? app.vault.getFileByPath(node.location.path)
            : null
        if (!file || file.extension !== "md") return null
        return node?.nodeType === "header"
            ? {key: `${file.path}#${node.header}`, path: file.path, heading: node.header, label: `${file.basename} > ${node.header}`}
            : {key: file.path, path: file.path, heading: null, label: file.basename}
    }

    /** The content pane's page, link line or heading row being edited, else the outline root's note; null at the
     *  search root or without such a file (a reference, today's note not created yet). */
    const paneRefAtom = atom<BodyRef | null>(get => {
        const o = get(outlineAtom)
        if (!o) return null
        get(GlobalAtoms.graphVersionAtom)   // a note a save created resolves after its reindex
        const edited = get(lineEditAtom)?.row?.node
        if (edited && edited.nodeType !== "text") return bodyRefOf(get, edited)
        const root = rootOf(o)
        return root === null ? null : bodyRefOf(get, root.kind === "today" ? null : root.node)
    })

    /** Reads `ref`'s text into outlineBodiesAtom: a new buffer, or a clean one (text === original) whose file changed.
     *  An edited buffer is left alone; its save checks freshness. A heading that is gone loads nothing. */
    const loadBodyAtom = atom(null, async (get, set, ref: BodyRef) => {
        const app = get(GlobalAtoms.appAtom)
        const file = app.vault.getFileByPath(ref.path)
        if (!file) return
        const content = await app.vault.read(file)
        const body = ref.heading === null ? noteBody(content) : headingBody(content, ref.heading)
        if (body === null || get(outlineAtom) === null) return
        const bodies = get(outlineBodiesAtom)
        const cur = bodies[ref.key]
        if (cur && (cur.text !== cur.original || cur.original === body)) return
        set(outlineBodiesAtom, {...bodies, [ref.key]: {...ref, original: body, text: body}})
    })

    /** The content pane's edit of buffer `key`. */
    const setBodyTextAtom = atom(null, (get, set, key: string, text: string) => {
        const bodies = get(outlineBodiesAtom)
        const cur = bodies[key]
        if (!cur || cur.text === text) return
        set(outlineBodiesAtom, {...bodies, [key]: {...cur, text}})
        set(discardArmedAtom, false)
    })

    /** Unsaved outline edits: a dirty content buffer or a changed line editor. */
    const outlineDirtyAtom = atom(get => {
        const edit = get(lineEditAtom)
        return dirtyBodyKeys(get(outlineBodiesAtom)).length > 0 || (edit !== null && edit.text !== edit.initial)
    })

    /** The pane's Discard: every content buffer back to its text on disk and the pane's pasted files trashed; the line
     *  editor is left alone. */
    const discardBodiesAtom = atom(null, (get, set) => {
        const bodies = get(outlineBodiesAtom)
        if (dirtyBodyKeys(bodies).length === 0) return
        void trashSessionAttachments(get(GlobalAtoms.appAtom), get(bodyAttachmentsAtom))
        set(bodyAttachmentsAtom, [])
        set(outlineBodiesAtom, Object.fromEntries(Object.entries(bodies).map(([k, b]) => [k, {...b, text: b.original}])))
        set(discardArmedAtom, false)
    })

    /** Before closing the line editor (`"line"`) or leaving / changing the outline's root (`"all"`, also the content
     *  buffers). True when nothing in scope is unsaved, or when this repeats a refused leave: the line editor closes
     *  (its pasted files trashed) and, for `"all"`, the buffers and the pane's pasted files go. Otherwise it shows the
     *  Notice once, arms the repeat and returns false (the caller does nothing). */
    const releaseOutlineAtom = atom(null, (get, set, scope: "line" | "all"): boolean => {
        const edit = get(lineEditAtom)
        const editDirty = edit !== null && edit.text !== edit.initial
        const bodies = get(outlineBodiesAtom)
        const dirty = scope === "all" ? dirtyBodyKeys(bodies) : []
        if ((editDirty || dirty.length > 0) && !get(discardArmedAtom)) {
            set(discardArmedAtom, true)
            const names = [...(editDirty ? [edit.row ? rowLabel(edit.row.node) : "the new line"] : []), ...dirty.map(k => bodies[k].label)]
            new Notice(`Unsaved changes to ${names.join(", ")} — do it again to discard them, or ${Platform.isMacOS ? "⌘↵" : "Ctrl+Enter"} to save`)
            return false
        }
        set(discardArmedAtom, false)
        const app = get(GlobalAtoms.appAtom)
        if (edit) void trashSessionAttachments(app, edit.attachments)
        set(lineEditAtom, null)
        if (scope === "all") {
            void trashSessionAttachments(app, get(bodyAttachmentsAtom))
            set(bodyAttachmentsAtom, [])
            set(outlineBodiesAtom, {})
        }
        return true
    })

    const incrementPagesAtom = atom(
        null,
        (get, set) => set(pagesAtom, get(pagesAtom) + 1)
    )

    const selectedNodeAtom = atom<TreeNode | null>(get => {
        const sel = get(selectedLineAtom)
        if (sel == -1) return null
        return get(treeNodesAtom)[sel] ?? null
    })

    /** The row plain Enter acts on: the selected row, else (nothing selected) the first result row; null when there is
     *  none. Only Enter falls back to the first row; `>`, `<`, → , Alt+keys and the action panel need a selection. */
    const enterRowAtom = atom<TreeNode | null>(get =>
        get(selectedNodeAtom) ?? (get(selectedLineAtom) === -1 ? get(renderableTreeNodesAtom).find(r => !r.archiveRow) ?? null : null))
    /** Selects enterRowAtom's row when nothing is selected, so the selected-row actions Enter runs see it. */
    const selectEnterRowAtom = atom(null, (get, set) => {
        const row = get(enterRowAtom)
        if (row && get(selectedLineAtom) !== row.index) set(selectedLineAtom, row.index)
    })

    // Per-view (scope name) Tree/Timeline mode, persisted to data.json by main.ts.
    const viewModeAtom = atom<SearchViewMode>(get => get(searchViewModesAtom)[scp.name] ?? "tree")
    const timelineActiveAtom = atom(get => scp.allowTimeline === true && get(viewModeAtom) === "timeline" && !get(editorOpenAtom) && !get(outlineAtom))
    const toggleViewModeAtom = atom(null, (get, set) =>
        set(searchViewModesAtom, {...get(searchViewModesAtom), [scp.name]: get(viewModeAtom) === "timeline" ? "tree" : "timeline"}))
    // View-local recency filter; narrows the timeline, or prunes the tree to
    // in-window branches (pruneToRecency), without touching the query.
    const recencyWindowAtom = atom<RecencyWindow>("all")
    // Raw results of the last search, kept so mode/window changes can re-project
    // without re-running the search.
    const lastResultsAtom = atom<{ results: ResultNode[]; archivedCount: number }>({ results: [], archivedCount: 0 })

    /** Whether results select their first row on their own: everywhere but the Search pane and modal (`allowEditing`),
     *  and there too while the editor shows its link list or the query has an open `[[frag` (link completion). */
    const autoSelectsFirst = (get: Getter) => !scp.allowEditing || get(editorOpenAtom) || openLinkAt(get(actualQueryAtom)) !== null

    /** Installs recomputed `nodes`, selecting the pending/anchored row if present, else the first row where
     *  `autoSelectsFirst`, else none. */
    const settleSelection = (get: Getter, set: Setter, nodes: TreeNode[]) => {
        const query = get(actualQueryAtom)
        const pending = get(GlobalAtoms.pendingSelectAtom)
        if (pending?.view === scp.name) {
            set(GlobalAtoms.pendingSelectAtom, null)
            set(selectAnchorAtom, {targets: pending.targets, flash: pending.flash, query})
        }
        let anchor = get(selectAnchorAtom)
        if (anchor && anchor.query !== query) {
            set(selectAnchorAtom, null)
            anchor = null
        }
        const i = anchor ? findTargetRow(nodes, anchor.targets) : -1
        if (anchor && i >= 0) {
            const revealed = revealRow(nodes, i)
            let visiblePos = 0
            for (let j = 0; j < i; j++) if (revealed[j].visible) visiblePos++
            set(treeNodesAtom, revealed)
            set(pagesAtom, Math.max(1, Math.ceil((visiblePos + 1) / get(pageSizeAtom))))
            set(selectedLineValueAtom, nodes[i].index)
            if (anchor.flash) {
                set(flashLineAtom, nodes[i].index)
                set(selectAnchorAtom, {...anchor, flash: false})
            }
        } else {
            const first = get(selectFirstOnceAtom)
            set(selectFirstOnceAtom, false)
            set(treeNodesAtom, nodes)
            set(pagesAtom, 1)
            set(selectedLineValueAtom, first || (get(searchVisibleAtom) && autoSelectsFirst(get)) ? 0 : -1)
        }
        set(hoveredLineAtom, -1)
    }

    const updateSearchResultsAtom = atom(null, (get, set, result: ResultNode[], archivedCount: number = 0) => {
        set(lastResultsAtom, { results: result, archivedCount })

        // The editor's link list and the outline editor are never narrowed by the view's recency window.
        const w = get(editorOpenAtom) || get(outlineAtom) ? "all" : get(recencyWindowAtom)
        if (get(timelineActiveAtom)) {
            const nodes = buildTimelineRows(get(GlobalAtoms.appAtom), get(GlobalAtoms.graphAtom), result, get(matchExprsAtom), w === "all" ? null : parseDuration(w))
            settleSelection(get, set, nodes)
            return
        }

        // Tree-mode recency: prune to in-window branches before flattening.
        if (w !== "all") result = pruneToRecency(result, parseDuration(w)!)

        // Calculate dynamic expand level first
        const dynamicExpand = get(searchQueryAtom).query
            ? Math.round(Math.max(0, 10 - result.length / 20))
            : -1

        // Set dynamic expand level before getting the expand level
        set(dynamicExpandAtom, dynamicExpand)

        // Get the current expand level (which now includes the updated dynamic expand)
        const expandLevel = get(getExpandLevel)

        // Flatten nodes with the correct expand level, tagging each row's
        // `matched` flag against the active query (drives dimming in the view).
        // Greyed-out subtrees start collapsed (defaultVisibility). The outline editor lists siblings in file order,
        // everything expanded.
        const nodesWithVisibility: TreeNode[] = flattenIndex(result, expandLevel, get(matchExprsAtom),
            get(outlineAtom) ? {fileOrder: true, expandAll: true} : {})
        tagOutlineParents(get(GlobalAtoms.graphAtom), nodesWithVisibility)

        const searchVisible = get(searchVisibleAtom)

        console.debug("updateSearchResultsAtom setting atoms:", new Date().toISOString().slice(11, 23), {
            nodesCount: nodesWithVisibility.length,
            dynamicExpand,
            expandLevel,
            searchVisible
        })

        // Try to batch updates by doing them all synchronously
        // This should minimize the number of atom recalculations

        // Add synthetic archive indicator node if there are archived items
        if (archivedCount > 0) {
            const archiveNode = {
                node: {
                    nodeType: "text",
                    parsedTokens: [{ tokenType: "text", text: `Archive (${archivedCount} items)`, decoration: "none" }],
                    searchKey: `archive (${archivedCount} items)`,
                    location: { file: "", line: 0 },
                    tags: [],
                    isTask: false,
                    isCompleted: false,
                    ageDays: 0,
                    boost: 0
                },
                indent: 0,
                hasChildren: false,
                visible: true,
                selected: false,
                index: nodesWithVisibility.length,
                matched: true,
                archiveRow: true
            } as any
            nodesWithVisibility.push(archiveNode)
        }

        settleSelection(get, set, nodesWithVisibility)
    })

    const rebuildResultsAtom = atom(null, (get, set) => {
        const { results, archivedCount } = get(lastResultsAtom)
        set(updateSearchResultsAtom, results, archivedCount)
    })

    /** ↓: the next visible row; past the last one, the outline editor's New line row. */
    const arrowDownAtom = atom(null, (get, set) => {
        const line = get(selectedLineAtom)
        if (line === NEW_LINE_ROW) return
        const nodes = get(treeNodesAtom)
        const nextVisible = nodes.slice(line + 1).find(node => node.visible)
        if (!nextVisible && newLineShown(get)) set(selectedLineAtom, NEW_LINE_ROW)
        else set(selectedLineAtom, nextVisible?.index ?? nodes.length - 1)
    })

    /** ↑: the previous visible row (from the New line row: the last one). */
    const arrowUpAtom = atom(null, (get, set) => {
        const line = get(selectedLineAtom)
        if (line === -1) return
        const nodes = get(treeNodesAtom)
        const before = line === NEW_LINE_ROW ? nodes : nodes.slice(0, line)
        const prevVisible = before.slice().reverse().find(node => node.visible)
        set(selectedLineAtom, prevVisible?.index ?? (autoSelectsFirst(get) ? 0 : -1))
    })

    const updateHoveredLineAtom = atom(null, (get, set, index: number) => {
        set(hoveredLineAtom, index)
    })



//  make all children  of the current node visible or invisible
    const expandNodeAtom = atom(null, (get, set, index: number) => {

        const treeNodes = get(treeNodesAtom)
        const startIndex = treeNodes.findIndex(it => it.index == index)
        if (startIndex == -1) return

        const nodeToExpand = treeNodes[index]
        const childVisible = treeNodes[startIndex + 1]?.visible

        for (let i = index + 1; i < treeNodes.length; i++) {
            if (treeNodes[i].indent <= nodeToExpand.indent) {
                break
            }

            if (!childVisible && treeNodes[i].indent == nodeToExpand.indent + 1) {
                treeNodes[i].visible = !childVisible
                treeNodes[i].compacted = false
            } else {
                treeNodes[i].visible = false
            }
        }

        set(treeNodesAtom, [...treeNodes])
    })

    const userExpandLevel = atom<number | null>(null)
    const defaultExpandLevelAtom = atom(0)
    const dynamicExpandAtom = atom(-1)

    const setDefaultExpandLevelAtom = atom(
        (get) => get(defaultExpandLevelAtom),
        (get, set, newValue: number) => {
            set(defaultExpandLevelAtom, newValue)
            set(expandVisibleNodesAtom) // Trigger the expand nodes
        }
    )

    const getExpandLevel = atom((get) => {
        if (get(dynamicExpandAtom) > 0)
            return get(dynamicExpandAtom)
        return get(userExpandLevel) ?? get(defaultExpandLevelAtom)
    })

    const incExpandAtom = atom(null, (get, set) => {
        set(userExpandLevel, get(getExpandLevel) + 1)
        set(dynamicExpandAtom, -1)
        set(expandVisibleNodesAtom)
    })

    const decExpandAtom = atom(null, (get, set) => {
        set(userExpandLevel, Math.max(0, get(getExpandLevel) - 1))
        set(dynamicExpandAtom, -1)
        set(expandVisibleNodesAtom)
    })

    const expandVisibleNodesAtom = atom(null, (get, set) => {
        const level = get(getExpandLevel)
        const treeNodes = get(treeNodesAtom)
        const visible = defaultVisibility(treeNodes, level)
        const newNodes = treeNodes.map((it, i) => ({ ...it, visible: visible[i].visible, compacted: visible[i].compacted }))
        set(treeNodesAtom, newNodes)
    })

    /** "+N more" footers of the tree's compacted lists (blockFooters). */
    const blockFootersAtom = atom(get => blockFooters(get(treeNodesAtom)))

    /** Reveals the compacted direct children of the list row with `index` listIndex. */
    const showCompactedAtom = atom(null, (get, set, listIndex: number) => {
        const rows = [...get(treeNodesAtom)]
        const start = rows.findIndex(it => it.index === listIndex)
        if (start === -1) return
        const indent = rows[start].indent
        for (let i = start + 1; i < rows.length && rows[i].indent > indent; i++) {
            if (rows[i].indent === indent + 1 && rows[i].compacted) rows[i] = {...rows[i], visible: true, compacted: false}
        }
        set(treeNodesAtom, rows)
    })

    /** Shows all lines of the timeline block row with `index`, or only its previews. */
    const setBlockOpenAtom = atom(null, (get, set, index: number, open: boolean) => {
        set(treeNodesAtom, get(treeNodesAtom).map(r => r.index === index ? {...r, blockOpen: open} : r))
    })

    /** → in the search input on the selected row: reveals a list's compacted children, else toggles the row's
     *  children (Tree), or opens / closes a block row's lines (Timeline). False when the row has nothing to toggle. */
    const toggleRowAtom = atom(null, (get, set, index: number): boolean => {
        const rows = get(treeNodesAtom)
        const pos = rows.findIndex(r => r.index === index)
        const row = rows[pos]
        if (!row || row.archiveRow) return false
        if (row.timeline) {
            if (!row.timeline.block?.some(l => !l.preview)) return false
            set(setBlockOpenAtom, index, !row.blockOpen)
            return true
        }
        let compacted = false
        for (let i = pos + 1; i < rows.length && rows[i].indent > row.indent; i++) {
            if (rows[i].indent === row.indent + 1 && rows[i].compacted) compacted = true
        }
        if (compacted) set(showCompactedAtom, index)
        else if (row.hasChildren) set(expandNodeAtom, index)
        else return false
        return true
    })

    const resetCollapseAtom = atom(null, (get, set) => {
        set(userExpandLevel, 0)
        set(dynamicExpandAtom, -1)
        set(expandVisibleNodesAtom)
    })

    const matchTermsAtom = atom<string[]>((get) => {
        const query = get(searchTextAtom)
        if (!query) return []
        const separator = get(separatorAtom)
        return parseQuery(query, separator).flatMap(extractTerms)
    })

    /** Query `q`'s stages as searched: `:Name` filter references expanded, `is:archived` (a reveal toggle, not a
     *  matcher) stripped. Empty for a blank query. */
    const stagesOf = (get: Getter, q: string): QueryExpr[] => {
        if (!q.trim()) return []
        const separator = get(separatorAtom)
        return extractArchiveReveal(parseQuery(expandFilterRefs(q, get(searchFiltersAtom), separator), separator)).stages
    }

    /** The outline editor's filter: its filter crumbs, then the input, as stages ANDed together. */
    const outlineFilterStagesAtom = atom<QueryExpr[]>(get => {
        const o = get(outlineAtom)
        return o ? [...o.filters, get(actualQueryAtom)].flatMap(q => stagesOf(get, q)) : []
    })

    // Parsed query stages, used to compute each row's `matched` flag (rows that
    // match no stage are pure ancestor/descendant context and get dimmed).
    // Empty when there is no query. The outline editor dims by its filter (at the search root, after the search's).
    const matchExprsAtom = atom<QueryExpr[]>((get) => {
        const o = get(outlineAtom)
        if (o) return [...(o.path.length === 0 ? stagesOf(get, o.prevQuery) : []), ...get(outlineFilterStagesAtom)]
        return stagesOf(get, get(actualQueryAtom))
    })

    const cursorPosAtom = atom(0)

    const rawSuggestionsAtom = atom<Suggestion[]>((get) => {
        const query = get(actualQueryAtom)
        const cursorPos = get(cursorPosAtom)
        const filterHits = filterSuggestionsAt(query, cursorPos, get(searchFiltersAtom))
        return filterHits.length > 0 ? filterHits : suggestAt(query, cursorPos)
    })

    const suggestionsDismissedAtom = atom(false)

    const suggestionsAtom = atom<Suggestion[]>((get) =>
        get(suggestionsDismissedAtom) ? [] : get(rawSuggestionsAtom)
    )

    const rawSuggestionIndexAtom = atom(0)

    const suggestionIndexAtom = atom(
        (get) => Math.min(get(rawSuggestionIndexAtom), Math.max(0, get(suggestionsAtom).length - 1)),
        (_get, set, index: number) => set(rawSuggestionIndexAtom, index)
    )

    const dismissSuggestionsAtom = atom(null, (_get, set) => set(suggestionsDismissedAtom, true))

    const resetSuggestionsAtom = atom(null, (_get, set) => {
        set(suggestionsDismissedAtom, false)
        set(rawSuggestionIndexAtom, 0)
    })

    const repositionSuggestionsAtom = atom(null, (_get, set) => set(rawSuggestionIndexAtom, 0))

    // Nonce bumped whenever the query should re-focus the search input (e.g. after
    // the syntax-help panel inserts a token). SearchBar watches it and focuses.
    const focusSearchInputAtom = atom(0)

    // Append a syntax token from the help panel to the current query (space-
    // separated), or set it when the box is empty, then request input focus.
    const appendQueryTokenAtom = atom(null, (get, set, token: string) => {
        const current = get(searchQueryAtom).query
        const trimmed = current.replace(/\s+$/, "")
        const next = trimmed.length === 0 ? token : `${trimmed} ${token}`
        set(searchQueryAtom, { query: next })
        set(lastSearchAtom, { query: next })
        set(focusSearchInputAtom, get(focusSearchInputAtom) + 1)
    })

    /** Filter pill: adds or removes the filter's `:Name` reference in the search query (toggleFilterPill). */
    const toggleFilterAtom = atom(null, (get, set, filter: SearchFilter) => {
        const next = toggleFilterPill(get(searchQueryAtom).query, filter)
        set(searchQueryAtom, {query: next})
        set(lastSearchAtom, {query: next})
    })

    // Action panel (footer "Actions", ⌘K, mobile long-press). Bound to the row selected when it
    // opened, so selecting another row closes it without an effect racing the open.
    const actionPanelStateAtom = atom<{page: ActionPanelPage; line: number} | null>(null)
    const actionPanelAtom = atom<ActionPanelPage | null>(get => {
        const panel = get(actionPanelStateAtom)
        return panel && panel.line === get(selectedLineAtom) ? panel.page : null
    })
    const openActionPanelAtom = atom(null, (get, set, page: ActionPanelPage = "main") =>
        set(actionPanelStateAtom, {page, line: get(selectedLineAtom)}))
    const closeActionPanelAtom = atom(null, (_get, set) => set(actionPanelStateAtom, null))
    const toggleActionPanelAtom = atom(null, (get, set) => {
        if (get(actionPanelAtom)) set(actionPanelStateAtom, null)
        else set(openActionPanelAtom)
    })

    // ── Reparent chain (`<`) ────────────────────────────────────────────────
    const setQuery = (set: Setter, query: string) => {
        set(searchQueryAtom, {query})
        set(lastSearchAtom, {query})
    }
    const refreshChainResultsAtom = atom(null, (get, set) => {
        const chain = get(chainAtom)
        if (!chain) return
        const options = get(GlobalAtoms.indexAtom)?.searchOptions() ?? {}
        set(updateSearchResultsAtom, chainResults(get(GlobalAtoms.graphAtom), chain, get(searchTextAtom), get(separatorAtom), options))
    })

    /** The selected row as a chip: its node, label and (Tree mode) tree parent; null without a usable selection. */
    const selectedRowRef = (get: Getter): {row: TreeNode; ref: RowRef} | null => {
        const sel = get(selectedNodeAtom)
        if (!sel || sel.archiveRow) return null
        const rows = get(renderableTreeNodesAtom)
        const pos = rows.findIndex(r => r.index === sel.index)
        const parentPos = pos >= 0 && !get(timelineActiveAtom) ? treeParentPos(rows, pos) : null
        return {row: sel, ref: {node: sel.node, label: rowLabel(sel.node), parent: parentPos === null ? null : rows[parentPos].node}}
    }

    /** Escape, × or Backspace in an empty input: ends the reparent chain, back to the search it started from with the
     *  row then selected. */
    const cancelChainAtom = atom(null, (get, set) => {
        const chain = get(chainAtom)
        if (!chain) return
        const targets = get(chainReturnAtom)
        set(chainAtom, null)
        if (targets.length > 0) set(GlobalAtoms.pendingSelectAtom, {view: scp.name, targets, flash: false})
        setQuery(set, chain.prevQuery)
    })

    // ── Outline editor navigation ───────────────────────────────────────────
    /** The outline editor's rows: the root's full tree (the search root: the results of the search it opened on),
     *  narrowed by the filter crumbs and the input; pinned lines stay, marked `miss`. */
    const refreshOutlineResultsAtom = atom(null, (get, set) => {
        const o = get(outlineAtom)
        if (!o) return
        const graph = get(GlobalAtoms.graphAtom)
        const separator = get(separatorAtom)
        const root = rootOf(o)
        let results: ResultNode[]
        if (root === null) {
            const text = expandFilterRefs(o.prevQuery, get(searchFiltersAtom), separator)
            const {reveal} = extractArchiveReveal(parseQuery(text, separator))
            results = partitionArchived(searchIndex(graph, text, separator, get(GlobalAtoms.indexAtom)?.searchOptions()), reveal).visible
        } else {
            results = advancedSearch(graph, rootKey(root, dailyNameOf(get)), "", separator)
        }
        set(updateSearchResultsAtom, filterOutline(results, get(outlineFilterStagesAtom), n => isPinned(o.pins, n)))
    })

    /** Shows the outline editor at path crumbs `path`: opens it (remembering the query and selected row to return
     *  to), or changes its root (unless unsaved edits refuse it; filter crumbs go). Today opens the New line, filled
     *  with `prefill`. */
    function showOutline(get: Getter, set: Setter, path: OutlineRoot[], target: OutlineTarget): true {
        const daily = dailyNameOf(get)
        const o = get(outlineAtom)
        const quickAdd = target.kind === "today" && target.quickAdd === true
        if (o) {
            const same = path.length === o.path.length && path.every((r, i) => crumbKey(r, daily) === crumbKey(o.path[i], daily))
            if (!same) {
                if (!set(releaseOutlineAtom, "all")) return true
                set(outlineAtom, {...o, path, filters: [], quickAdd: o.quickAdd || quickAdd})
                set(paneAtom, {...get(paneAtom), closedKey: null})
            }
        } else {
            const sel = get(selectedNodeAtom)
            set(outlineAtom, {path, filters: [], prevQuery: get(actualQueryAtom), returnTo: sel && !sel.archiveRow ? rowTargets(sel) : [], quickAdd, pins: []})
            set(paneAtom, {size: "normal", closedKey: null})
        }
        set(closeActionPanelAtom)
        set(searchVisibleAtom, true)
        setQuery(set, "")
        if (target.kind === "today") set(openNewLineAtom, target.prefill ?? "")
        else set(focusSearchInputAtom, get(focusSearchInputAtom) + 1)
        return true
    }

    /** Opens the outline editor (Search modal and pane only; not during a reparent): on the search, on Today, on a
     *  row's full tree (default: the selected row) or on a note or heading link (`Name`, `Name#Heading`). A row's
     *  crumbs follow its hierarchy (patchPath); inside the outline editor they are added after the current ones. A link
     *  opens the row showing that note or heading when there is one, else its own crumbs (`Note`, or `Note › Heading`)
     *  replace the path. False when it doesn't apply (no such row, a link to a file that isn't a note or to no note):
     *  the caller then opens it in Obsidian. */
    const openOutlineAtom = atom(null, (get, set, target: OutlineTarget): boolean => {
        if (!scp.allowEditing || get(chainAtom) !== null) return false
        if (target.kind === "search") return showOutline(get, set, [], target)
        if (target.kind === "today") return showOutline(get, set, [{kind: "today"}], target)
        const graph = get(GlobalAtoms.graphAtom)
        const daily = dailyNameOf(get)
        const rows = get(renderableTreeNodesAtom)
        let pos: number
        if (target.kind === "link") {
            const [page, heading] = target.link.split("#").map(s => s.trim())
            const file = get(GlobalAtoms.appAtom).metadataCache.getFirstLinkpathDest(page, "")
            if (!page || (file ? file.extension !== "md" : /\.(?!md$)[a-z0-9]+$/i.test(page))) return false
            // The note or heading shown as a row (the selected one first): opened as that row.
            const sel = get(selectedNodeAtom)
            pos = sel && !sel.archiveRow && linksTo(sel.node, page, heading)
                ? rows.findIndex(r => r.index === sel.index)
                : rows.findIndex(r => !r.archiveRow && linksTo(r.node, page, heading))
            if (pos < 0) {
                const crumbs = linkCrumbs(graph, page, heading, daily)
                return crumbs !== null && showOutline(get, set, crumbs, target)
            }
        } else {
            const row = target.row ?? get(selectedNodeAtom)
            if (!row || row.archiveRow || !isPatchable(row.node)) return false
            pos = rows.findIndex(r => r.index === row.index)
            if (pos < 0) return false
        }
        const o = get(outlineAtom)
        const added = patchPath(graph, rows, pos, o !== null).map(n => rootFor(n, daily))
        return showOutline(get, set, extendPath(o?.path ?? [], added, daily), target)
    })

    /** The New line row's editor, filled with `prefill` (an item such as chainPrefill's; its bullet and checkbox are
     *  the prefix). A changed line editor refuses it once. */
    const openNewLineAtom = atom(null, (get, set, prefill: string = "") => {
        if (get(lineEditAtom) && !set(releaseOutlineAtom, "line")) return
        const m = /^- (\[.\] )?/.exec(prefill)
        const prefix = m ? m[0] : "- "
        const text = m ? prefill.slice(m[0].length) : prefill
        set(lineEditAtom, {id: nextLineEditId(), row: null, prefix, text, initial: text, caret: text.length, attachments: [], saving: false})
    })

    /** The row a plain-search Add to explores first: the selected page, heading or line; null for none. */
    const addToRow = (get: Getter): TreeNode | null => {
        const sel = get(selectedNodeAtom)
        return sel && !sel.archiveRow && isPatchable(sel.node) ? sel : null
    }

    /** The note and pre-filled line Add to uses when no row is selected: in the outline editor the line is built from
     *  its filter crumbs (at the search root also from the search's query, which writes to Today); in the plain search
     *  from the query (addToPlan: its `[[Note]]` scope is the note the line goes under). */
    const addToPlanOf = (get: Getter): {note: string | null; prefill: string} => {
        const separator = get(separatorAtom)
        const archiveTag = get(settingsAtom).archiveTag
        const o = get(outlineAtom)
        if (!o) return addToPlan(get(searchTextAtom), separator, archiveTag)
        const filters = get(searchFiltersAtom)
        const text = [o.path.length === 0 ? o.prevQuery : "", ...o.filters].map(q => expandFilterRefs(q, filters, separator)).join(" ")
        return {note: null, prefill: chainPrefill(text, separator, archiveTag)}
    }

    /** The Add to row's (and the action panel's Add to) label: in the outline editor `Add to <root>`; in the plain
     *  search `Add to <selected row>`, else `Add to <the query's [[Note]] scope>`, or `Add to Today`. */
    const addToLabelAtom = atom(get => {
        const o = get(outlineAtom)
        if (o) return newLineLabel(o)
        const row = addToRow(get)
        return `Add to ${row ? rowLabel(row.node) : addToPlanOf(get).note ?? TODAY_LABEL}`
    })

    /** Add to: the line editor on a new line at the end of the view, pre-filled from the filters (addToPlanOf).
     *  Outside the outline editor it first explores the selected row; with nothing selected it explores the note the
     *  query scopes to (`[[Note]] > is:task home` adds `- [ ] home ` under Note); with no search, Today (Quick Add);
     *  with a search and no such note, the search (its new lines go to today's note). */
    const openAddToAtom = atom(null, (get, set) => {
        const plan = addToPlanOf(get)
        let prefill = plan.prefill
        if (get(outlineAtom) === null) {
            const row = addToRow(get)
            if (row) {
                if (!set(openOutlineAtom, {kind: "row", row})) return
                prefill = ""
            } else if (plan.note !== null && set(openOutlineAtom, {kind: "link", link: plan.note})) {
                // Under the note the query scopes to.
            } else if (get(actualQueryAtom).trim() === "") {
                set(openOutlineAtom, {kind: "today", quickAdd: true})
                return
            } else {
                if (!set(openOutlineAtom, {kind: "search"})) return
                prefill = chainPrefill(get(searchTextAtom), get(separatorAtom), get(settingsAtom).archiveTag)
            }
        }
        set(openNewLineAtom, prefill)
    })

    /** The line editor's edit (its field, caret, pasted files); an edit disarms a refused discard. */
    const updateLineEditAtom = atom(null, (get, set, fn: (e: LineEdit) => LineEdit) => {
        const cur = get(lineEditAtom)
        if (!cur) return
        const next = fn(cur)
        if (next.text !== cur.text) set(discardArmedAtom, false)
        set(lineEditAtom, next)
    })

    /** Leaves the outline editor (unless unsaved edits refuse it): back to the query typed before it, with the row then
     *  selected. */
    const exitOutlineAtom = atom(null, (get, set) => {
        const o = get(outlineAtom)
        if (!o || !set(releaseOutlineAtom, "all")) return
        set(outlineAtom, null)
        if (o.returnTo.length > 0) set(GlobalAtoms.pendingSelectAtom, {view: scp.name, targets: o.returnTo, flash: false})
        setQuery(set, o.prevQuery)
        set(focusSearchInputAtom, get(focusSearchInputAtom) + 1)
    })

    /** Backspace in an empty input: drops the last crumb (a filter crumb's text returns to the input; a path crumb
     *  moves the root up); with none left, leaves the outline editor. */
    const popCrumbAtom = atom(null, (get, set) => {
        const o = get(outlineAtom)
        if (!o) return
        if (o.filters.length > 0) {
            set(outlineAtom, {...o, filters: o.filters.slice(0, -1)})
            setQuery(set, o.filters[o.filters.length - 1])
            return
        }
        if (o.path.length === 0) {
            set(exitOutlineAtom)
            return
        }
        if (!set(releaseOutlineAtom, "all")) return
        set(outlineAtom, {...o, path: o.path.slice(0, -1)})
        set(paneAtom, {...get(paneAtom), closedKey: null})
    })

    /** A click on path crumb `i`: makes it the root, dropping the later crumbs and every filter crumb. */
    const openCrumbAtom = atom(null, (get, set, i: number) => {
        const o = get(outlineAtom)
        if (!o || i < 0 || i >= o.path.length) return
        const rootChanges = i < o.path.length - 1
        if (rootChanges && !set(releaseOutlineAtom, "all")) return
        set(outlineAtom, {...o, path: o.path.slice(0, i + 1), filters: []})
        if (rootChanges) set(paneAtom, {...get(paneAtom), closedKey: null})
        set(focusSearchInputAtom, get(focusSearchInputAtom) + 1)
    })

    /** A click on filter crumb `i`: drops the crumbs after it. */
    const openFilterCrumbAtom = atom(null, (get, set, i: number) => {
        const o = get(outlineAtom)
        if (!o || i < 0 || i >= o.filters.length) return
        set(outlineAtom, {...o, filters: o.filters.slice(0, i + 1)})
        set(focusSearchInputAtom, get(focusSearchInputAtom) + 1)
    })

    /** Enter with text in the input: the text becomes a filter crumb and the first row is selected. */
    const addFilterAtom = atom(null, (get, set) => {
        const o = get(outlineAtom)
        const q = get(actualQueryAtom).trim()
        if (!o || !q) return
        set(selectFirstOnceAtom, true)
        set(outlineAtom, {...o, filters: [...o.filters, q]})
        setQuery(set, "")
    })


    /** The selected row when Move under can take it (a folder note row stands for its folder); else null, with a
     *  Notice for a row that can't move. */
    function movableSelectedRef(get: Getter): RowRef | null {
        const selected = selectedRowRef(get)
        if (!selected) return null
        const node = selected.ref.node
        if (!isMovable(node)) {
            new Notice(node.nodeType === "header" ? "Headings can't be moved — move their page or their lines" : "This row can't be moved")
            return null
        }
        if (node.nodeType === "text" && selected.row.indent > 0) {
            const rows = get(renderableTreeNodesAtom)
            const pos = rows.findIndex(r => r.index === selected.row.index)
            if (dragInfo(rows, pos).refusal === INLINE_LINK_REFUSAL) {
                new Notice(INLINE_LINK_REFUSAL)
                return null
            }
        }
        return node.nodeType === "folderNote" ? {...selected.ref, node: node.folder, label: rowLabel(node.folder)} : selected.ref
    }

    /** Starts the reparent chain over `children`; the query then searches their new parent. Shows the search input
     *  of a pane that hid it. */
    function beginReparent(get: Getter, set: Setter, children: RowRef[], prevQuery: string) {
        set(chainAtom, {mode: "reparent", children, prevQuery, confirm: null})
        setQuery(set, "")
        set(searchVisibleAtom, true)
        set(focusSearchInputAtom, get(focusSearchInputAtom) + 1)
    }

    /** Move under (`<`, Alt+M, action panel): the selected row becomes the one to move; the query then searches its new
     *  parent (a page, header, line or folder, by the row's type). */
    const startReparentAtom = atom(null, (get, set) => {
        if (get(outlineAtom)) return
        const child = movableSelectedRef(get)
        if (child) beginReparent(get, set, [child], get(actualQueryAtom))
    })

    /** ⌘X / the panel's Cut: adds the selected row to the cut drawer, or takes it out when it is there; ignored during
     *  a reparent and in the outline editor. The selection stays. */
    const toggleCutAtom = atom(null, (get, set) => {
        if (get(chainAtom) || get(outlineAtom)) return
        const ref = movableSelectedRef(get)
        if (ref) set(GlobalAtoms.cutDrawerAtom, toggleCut(get(GlobalAtoms.cutDrawerAtom), ref))
    })

    /** The drawer's Move under…: the reparent chain over every cut row; Enter on a target moves them all
     *  (reparentChainAtom). */
    const startDrawerMoveAtom = atom(null, (get, set) => {
        const items = get(GlobalAtoms.cutDrawerAtom)
        if (items.length === 0 || get(outlineAtom)) return
        beginReparent(get, set, [...items], get(chainAtom)?.prevQuery ?? get(actualQueryAtom))
    })

    // ── The editor shown in place (Search modal / pane) ─────────────────────
    /** The query and selected row this view returns to when its editor closes; null while it shows its search. */
    const editorReturnAtom = atom<{query: string; selected: RowTarget[]} | null>(null)
    /** This view shows the editor (Search modal / pane only). */
    const editorOpenAtom = atom(get => scp.allowEditing && get(GlobalAtoms.editorHostAtom) === scp.name)
    /** The Search modal's title (searchModalTitle); null in the other views. */
    const searchModalTitleAtom = atom(get => scp.isModal && scp.allowEditing
        ? searchModalTitle(get(editorOpenAtom) ? get(GlobalAtoms.editSessionAtom) : null, get(outlineAtom))
        : null)

    /** Switches this view to the editor, remembering the query and selected row to return to. A prose or Alt-Edit
     *  session opened from inside the editor keeps the first return point. */
    const enterEditorAtom = atom(null, (get, set) => {
        if (get(editorReturnAtom) === null) {
            const sel = get(selectedNodeAtom)
            set(editorReturnAtom, {query: get(actualQueryAtom), selected: sel && !sel.archiveRow ? rowTargets(sel) : []})
        }
        set(chainAtom, null)
        set(closeActionPanelAtom)
        set(searchVisibleAtom, true)
        set(GlobalAtoms.editorHostAtom, scp.name)
        // Re-project the last results in Tree mode for the editor's link list.
        set(rebuildResultsAtom)
    })

    /** Back to the search from the editor: restores the query, then selects `saved` (flashing) or the row selected
     *  before; `focus` focuses and selects the query. */
    const leaveEditorAtom = atom(null, (get, set, {saved, focus}: {saved: RowTarget[] | null; focus: boolean}) => {
        if (get(GlobalAtoms.editorHostAtom) === scp.name) set(GlobalAtoms.editorHostAtom, null)
        const r = get(editorReturnAtom)
        if (r === null) return
        set(editorReturnAtom, null)
        const targets = saved ?? r.selected
        if (targets.length > 0) set(GlobalAtoms.pendingSelectAtom, {view: scp.name, targets, flash: saved !== null})
        // The results view's mount rebuild must not settle the pending row on the editor's rows; the recompute for
        // the restored query selects it.
        if (get(actualQueryAtom) !== r.query) set(lastResultsAtom, {results: [], archivedCount: 0})
        setQuery(set, r.query)
        if (focus) set(GlobalAtoms.selectQueryAtom, {view: scp.name})
    })

    return {
            scopeName: {name: scp.name, instance: instance},
            actualQueryAtom,
            searchTextAtom,
            searchQueryAtom,
            searchResultsStateAtom,
            searchViewStateAtom,
            renderableTreeNodesAtom,
            incrementPagesAtom,
            hasMoreTreeNodesAtom,
            searchVisibleAtom,
            updateSearchResultsAtom,
            lastResultsAtom,
            arrowUpAtom,
            arrowDownAtom,
            decExpandAtom,
            incExpandAtom,
            resetCollapseAtom,
            selectedNodeAtom, enterRowAtom, selectEnterRowAtom, newLineSelectedAtom, newLineShownAtom, addToLabelAtom, openAddToAtom,
            searchPlaceholderAtom,
            setDefaultExpandLevelAtom,
            expandNodeAtom, selectedLineAtom, updateHoveredLineAtom, hoveredLineAtom,
            blockFootersAtom, showCompactedAtom, setBlockOpenAtom, toggleRowAtom,
            matchTermsAtom,
            matchExprsAtom,
            cursorPosAtom, suggestionsAtom, suggestionIndexAtom, dismissSuggestionsAtom, resetSuggestionsAtom,
            repositionSuggestionsAtom,
            focusSearchInputAtom, appendQueryTokenAtom, toggleFilterAtom,
            timelineActiveAtom, toggleViewModeAtom, recencyWindowAtom, rebuildResultsAtom,
            actionPanelAtom, openActionPanelAtom, closeActionPanelAtom, toggleActionPanelAtom,
            allowTimeline: scp.allowTimeline,
            allowEditing: scp.allowEditing,
            flashLineAtom,
            chainAtom, refreshChainResultsAtom, cancelChainAtom, startReparentAtom,
            toggleCutAtom, startDrawerMoveAtom,
            outlineAtom, lineEditAtom, outlineBodiesAtom, bodyAttachmentsAtom, discardArmedAtom, paneAtom,
            paneRefAtom, loadBodyAtom, setBodyTextAtom, releaseOutlineAtom, outlineDirtyAtom, discardBodiesAtom, outlineFilterStagesAtom,
            refreshOutlineResultsAtom, openOutlineAtom, openNewLineAtom, exitOutlineAtom, popCrumbAtom, openCrumbAtom,
            openFilterCrumbAtom, addFilterAtom, updateLineEditAtom,
            editorOpenAtom, enterEditorAtom, leaveEditorAtom, searchModalTitleAtom,
    }
})



export function extractTerms(expr: QueryExpr): string[] {
    switch (expr.type) {
        case "contains":   return [expr.value]
        case "equals":     return [expr.value]
        case "and":        return expr.exprs.flatMap(extractTerms)
        case "or":         return expr.exprs.flatMap(extractTerms)
        case "not":        return []
        case "modifier":   return []
        case "empty":      return []
    }
}
