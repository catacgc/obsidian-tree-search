import {TreeNode} from '../search/SearchViewFlatten'
import {advancedSearch, flattenTasks, ResultNode, searchIndex, searchParents, parseQuery, linkTargetTree, type QueryExpr, partitionArchived, extractArchiveReveal, suggestAt, dateSuggestAt, type Suggestion, parseDuration, flattenIndex, defaultVisibility, blockFooters, pruneToRecency} from '@mdtree/core'
import {atom, useAtomValue, type Getter, type Setter} from 'jotai'
import {findTargetRow, revealRow, rowTargets, type RowTarget} from '../search/select-target'
import {toggleTaskFilter} from '../search/task-filter'
import {buildTimelineRows} from '../search/timeline-utils'
import {chainOutline, chainResults, isEntryInput, isMovable, isPatchable, parseChainEntry, rowLabel, type ChainOutline, type ChainState, type RowRef} from '../search/chain'
import {basenameOf, dailyConfigOf, searchModalTitle} from '../editor/draft'
import {dailyNotePath} from '../../editing/vault-edits'
import {dragInfo, INLINE_LINK_REFUSAL, treeParentPos} from '../editor/row-editing'

type SearchQuery = { query: string; file?: string; heading?: string }
import {createScope, molecule} from "bunshi";
import {App, Notice} from "obsidian";
import {GlobalAtoms} from "./global";
import {searchViewModesAtom, separatorAtom, type SearchViewMode} from "./settings";
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
    isQuickAdd: false,
    showSearch: true,
    isModal: true,
    allowTimeline: false,
    allowEditing: false
})

export type RecencyWindow = "all" | "7d" | "30d" | "1y"
export const RECENCY_WINDOWS: RecencyWindow[] = ["all", "7d", "30d", "1y"]
/** The action panel's list: the main actions, the Move under… page list, or the Delete confirmation. */
export type ActionPanelPage = "main" | "moveUnder" | "confirmDelete"

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

/** Quick Add's results list without a parent and no `[[` open: the outline of today's daily note. */
export const DAILY_OUTLINE_QUERY = ":daily :page"

/** Quick Add's results list while no `[[` is open: the full tree of the outline's note nearest the caret (caretNote)
 *  as `[[P]]`; else, for an Append under a picked line, the outline of that line's note (`underLinePath`); else
 *  today's daily outline. A name with `[` or `]` can't be written as a link, so it counts as none. */
export const quickAddDefaultQuery = (parentName: string | undefined, underLinePath?: string): string =>
    parentName && !/[[\]]/.test(parentName) ? `[[${parentName}]]`
    : underLinePath ? `outline:"${underLinePath.replace(/\.md$/, "")}" :page`
    : DAILY_OUTLINE_QUERY

export const SearchModalMolecule = molecule((mol, scope) => {
    const scp = scope(SearchViewScope)
    const searchMol = mol(SearchViewMolecule)

    const searchResultsAtom = atom<ResultNode[]>([])

    const searchResultsComputeAtom = withAtomEffect(searchResultsAtom, (get, set) => {
        get(GlobalAtoms.graphVersionAtom)  // re-run on mutable graph updates from refreshPage
        const searchQuery = get(searchMol.actualQueryAtom)
        // A chain (`>` append, `<` reparent) replaces the search with its own results.
        const chain = get(searchMol.chainAtom)
        if (chain) {
            set(searchMol.refreshChainResultsAtom)
            return
        }
        const graph = get(GlobalAtoms.graphAtom)
        const separator = get(separatorAtom)
        const options = get(GlobalAtoms.indexAtom)?.searchOptions()

        if (scp.isQuickLink) {
            // Insert Link offers only link targets: notes and headers whose own name/alias/heading
            // matches the query, archived rows hidden. Its input is typed without `[[`.
            set(searchMol.updateSearchResultsAtom, linkTargetTree(graph, searchQuery, separator), 0)
            return
        }

        const searchResults = searchIndex(graph, searchQuery, separator, options)

        // `is:archived` reveals (rather than hides) archived rows; its presence
        // in the query flips partitioning from drop-with-count to keep-and-grey.
        const { reveal } = extractArchiveReveal(parseQuery(searchQuery, separator))
        const { visible, archivedCount } = partitionArchived(searchResults, reveal)
        set(searchMol.updateSearchResultsAtom, visible, archivedCount)
    })

    return { searchResultsComputeAtom }
})

export const SearchViewMolecule = molecule((mol, scope) => {
    const scp = scope(SearchViewScope)

    const instance = Math.random()

    const { lastSearchAtom } = mol(GlobalAppMolecule)

    // Quick Add's list is the editor's `[[` autocomplete (InlineEditor sets its query), never Search's query.
    const searchQueryAtom = atomWithDefault<SearchQuery>(get =>
        scp.isModal && !scp.isQuickAdd ? get(lastSearchAtom) : {query: ""})

    const actualQueryAtom = atom<string>(get => get(searchQueryAtom).query)
    const selectedLineValueAtom = atom(-1)
    /** Row to re-find on every recompute while the query is unchanged (a save's follow-up reindexes, a modal's mount-time rebuild); any user selection drops it. */
    const selectAnchorAtom = atom<{targets: RowTarget[]; flash: boolean; query: string} | null>(null)
    const selectedLineAtom = atom(get => get(selectedLineValueAtom), (_get, set, line: number) => {
        set(selectAnchorAtom, null)
        set(selectedLineValueAtom, line)
    })
    /** Search's append (`>`) or reparent (`<`) chain; null when searching normally. */
    const chainAtom = atom<ChainState | null>(null)
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
        if (chain?.mode === "reparent") return `Move ${chain.child.label} under…`
        if (chain?.mode === "append") {
            const last = chain.steps[chain.steps.length - 1]
            if (last.kind === "entry") return `Add under ${last.label} — Enter adds, Alt+Enter opens the editor`
            // The operators only: the chip and the modal's Patch title already name the anchor.
            return `- item · [[note]] · |alias · #heading · (k:: v)`
        }
        const { totalNodes } = get(searchResultsStateAtom)
        const graph = get(GlobalAtoms.graphAtom)
        if (totalNodes > 0) {
            return `Search ${totalNodes} nodes`
        }

        return `Search ${graph.order} nodes and ${graph.size} edges`
    })

    /** Today's daily note basename (the Today chip's note). */
    const dailyNameOf = (get: Getter) => basenameOf(dailyNotePath(dailyConfigOf(get(GlobalAtoms.indexAtom))))

    /** The append chain's pending write (what Enter adds), an error to show, or null when Enter searches/opens instead. */
    const chainWriteAtom = atom<ChainOutline | {error: string} | null>(get => {
        const chain = get(chainAtom)
        if (chain?.mode !== "append") return null
        const q = get(actualQueryAtom)
        const hasEntries = chain.steps.some(s => s.kind === "entry")
        const parsed = parseChainEntry(q)
        if (parsed !== null && "error" in parsed) return parsed
        // Typed text that matches rows stays a search; prefix `- ` to add it instead.
        if (!hasEntries && (parsed === null || (!isEntryInput(q) && get(renderableTreeNodesAtom).length > 0))) return null
        const o = chainOutline(chain.steps, parsed, dailyNameOf(get))
        if (!("error" in o) && o.lines.length === 0 && !o.underLine) return null
        return o
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

    /** In an append chain with nothing to write (the input searches under the chips), the selected row Enter adds as
     *  the next chip, as `>` does; null otherwise. */
    const chainPatchRowAtom = atom<TreeNode | null>(get => {
        const chain = get(chainAtom)
        if (chain?.mode !== "append" || get(chainWriteAtom) !== null) return null
        if (chain.steps.some(s => s.kind === "entry") || isEntryInput(get(actualQueryAtom))) return null
        const sel = get(selectedNodeAtom)
        return sel && !sel.archiveRow && isPatchable(sel.node) ? sel : null
    })

    // Per-view (scope name) Tree/Timeline mode, persisted to data.json by main.ts.
    const viewModeAtom = atom<SearchViewMode>(get => get(searchViewModesAtom)[scp.name] ?? "tree")
    const timelineActiveAtom = atom(get => scp.allowTimeline === true && get(viewModeAtom) === "timeline" && !get(editorOpenAtom))
    const toggleViewModeAtom = atom(null, (get, set) =>
        set(searchViewModesAtom, {...get(searchViewModesAtom), [scp.name]: get(viewModeAtom) === "timeline" ? "tree" : "timeline"}))
    // View-local recency filter; narrows the timeline, or prunes the tree to
    // in-window branches (pruneToRecency), without touching the query.
    const recencyWindowAtom = atom<RecencyWindow>("all")
    // Raw results of the last search, kept so mode/window changes can re-project
    // without re-running the search.
    const lastResultsAtom = atom<{ results: ResultNode[]; archivedCount: number }>({ results: [], archivedCount: 0 })

    /** Installs recomputed `nodes`, selecting the pending/anchored row if present, else the first row. */
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
            set(treeNodesAtom, nodes)
            set(pagesAtom, 1)
            set(selectedLineValueAtom, get(searchVisibleAtom) ? 0 : -1)
        }
        set(hoveredLineAtom, -1)
    }

    const updateSearchResultsAtom = atom(null, (get, set, result: ResultNode[], archivedCount: number = 0) => {
        set(lastResultsAtom, { results: result, archivedCount })

        // The editor's link list is never narrowed by the view's recency window.
        const w = get(editorOpenAtom) ? "all" : get(recencyWindowAtom)
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
        // Greyed-out subtrees start collapsed (defaultVisibility).
        const nodesWithVisibility: TreeNode[] = flattenIndex(result, expandLevel, get(matchExprsAtom))

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

    const arrowDownAtom = atom(null, (get, set) => {
        const line = get(selectedLineAtom)
        const nodes = get(treeNodesAtom)
        const nextVisible = nodes.slice(line + 1).find(node => node.visible)

        set(selectedLineAtom, nextVisible?.index ?? nodes.length - 1)
    })

    const arrowUpAtom = atom(null, (get, set) => {
        const line = get(selectedLineAtom)
        const nodes = get(treeNodesAtom)
        const prevVisible = nodes.slice(0, line).reverse().find(node => node.visible)
        set(selectedLineAtom, prevVisible?.index ?? 0)
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
        const query = get(actualQueryAtom)
        if (!query) return []
        const separator = get(separatorAtom)
        return parseQuery(query, separator).flatMap(extractTerms)
    })

    // Parsed query stages, used to compute each row's `matched` flag (rows that
    // match no stage are pure ancestor/descendant context and get dimmed).
    // Empty when there is no query.
    const matchExprsAtom = atom<QueryExpr[]>((get) => {
        const query = get(actualQueryAtom)
        if (!query) return []
        const separator = get(separatorAtom)
        // Strip `is:archived` (a reveal toggle, not a matcher) so it never drives
        // the per-row `matched`/dimming computation.
        return extractArchiveReveal(parseQuery(query, separator)).stages
    })

    const cursorPosAtom = atom(0)

    const rawSuggestionsAtom = atom<Suggestion[]>((get) => {
        const query = get(actualQueryAtom)
        const cursorPos = get(cursorPosAtom)
        // An append chain's task entry (`[ ] call Bob @tom`) offers scheduled dates instead of query syntax.
        const dates = get(chainAtom)?.mode === "append" ? dateSuggestAt(query, cursorPos, new Date()) : []
        return dates.length > 0 ? dates : suggestAt(query, cursorPos)
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

    /** Tasks chip: adds or removes `is:task` in the query (toggleTaskFilter). */
    const toggleTaskFilterAtom = atom(null, (get, set) => {
        const next = toggleTaskFilter(get(searchQueryAtom).query)
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

    // ── Chains: append (`>`) and reparent (`<`) ────────────────────────────
    const setQuery = (set: Setter, query: string) => {
        set(searchQueryAtom, {query})
        set(lastSearchAtom, {query})
    }
    const refreshChainResultsAtom = atom(null, (get, set) => {
        const chain = get(chainAtom)
        if (!chain) return
        const query = get(actualQueryAtom)
        const options = get(GlobalAtoms.indexAtom)?.searchOptions() ?? {}
        const results = chainResults(get(GlobalAtoms.graphAtom), chain, query, get(separatorAtom), options, dailyNameOf(get))
        set(updateSearchResultsAtom, results)
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

    /** Backspace in an empty input: drops the last chip (an append chain's last step, or the reparent), restoring the
     *  query typed before it. */
    const popChainAtom = atom(null, (get, set) => {
        const chain = get(chainAtom)
        if (!chain) return
        if (chain.mode === "reparent" || chain.steps.length === 1) {
            set(chainAtom, null)
            setQuery(set, chain.mode === "reparent" ? chain.prevQuery : chain.steps[0].prevQuery)
            return
        }
        const last = chain.steps[chain.steps.length - 1]
        set(chainAtom, {...chain, steps: chain.steps.slice(0, -1)})
        setQuery(set, last.prevQuery)
    })

    /** Escape: leaves the chain, restoring the query typed before its first chip. */
    const cancelChainAtom = atom(null, (get, set) => {
        const chain = get(chainAtom)
        if (chain?.mode !== "append") {
            set(popChainAtom)
            return
        }
        set(chainAtom, null)
        setQuery(set, chain.steps[0].prevQuery)
    })

    /** Move to (`<`, Alt+M, action panel): the selected row becomes the one to move; the query then searches its new
     *  parent (a page, header, line or folder, by the row's type). Shows the search input of a pane that hid it. */
    const startReparentAtom = atom(null, (get, set) => {
        const selected = selectedRowRef(get)
        if (!selected) return
        const node = selected.ref.node
        if (!isMovable(node)) {
            new Notice(node.nodeType === "header" ? "Headings can't be moved — move their page or their lines" : "This row can't be moved")
            return
        }
        if (node.nodeType === "text" && selected.row.indent > 0) {
            const rows = get(renderableTreeNodesAtom)
            const pos = rows.findIndex(r => r.index === selected.row.index)
            if (dragInfo(rows, pos).refusal === INLINE_LINK_REFUSAL) {
                new Notice(INLINE_LINK_REFUSAL)
                return
            }
        }
        // A folder note row stands for its folder.
        const child = node.nodeType === "folderNote" ? {...selected.ref, node: node.folder, label: rowLabel(node.folder)} : selected.ref
        set(chainAtom, {mode: "reparent", child, prevQuery: get(actualQueryAtom), confirm: null})
        setQuery(set, "")
        set(searchVisibleAtom, true)
        set(focusSearchInputAtom, get(focusSearchInputAtom) + 1)
    })

    const clearChainAtom = atom(null, (_get, set) => set(chainAtom, null))

    // ── The editor shown in place (Search modal / pane) ─────────────────────
    /** The query and selected row this view returns to when its editor closes; null while it shows its search. */
    const editorReturnAtom = atom<{query: string; selected: RowTarget[]} | null>(null)
    /** This view shows the editor (Search modal / pane only). */
    const editorOpenAtom = atom(get => scp.allowEditing && get(GlobalAtoms.editorHostAtom) === scp.name)
    /** The Search modal's title (searchModalTitle); null in the other views. */
    const searchModalTitleAtom = atom(get => scp.isModal && scp.allowEditing
        ? searchModalTitle(get(editorOpenAtom) ? get(GlobalAtoms.editSessionAtom) : null, get(chainAtom))
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
            selectedNodeAtom,
            searchPlaceholderAtom,
            setDefaultExpandLevelAtom,
            expandNodeAtom, selectedLineAtom, updateHoveredLineAtom, hoveredLineAtom,
            blockFootersAtom, showCompactedAtom, setBlockOpenAtom, toggleRowAtom,
            matchTermsAtom,
            matchExprsAtom,
            cursorPosAtom, suggestionsAtom, suggestionIndexAtom, dismissSuggestionsAtom, resetSuggestionsAtom,
            repositionSuggestionsAtom,
            focusSearchInputAtom, appendQueryTokenAtom, toggleTaskFilterAtom,
            timelineActiveAtom, toggleViewModeAtom, recencyWindowAtom, rebuildResultsAtom,
            actionPanelAtom, openActionPanelAtom, closeActionPanelAtom, toggleActionPanelAtom,
            allowTimeline: scp.allowTimeline,
            allowEditing: scp.allowEditing,
            flashLineAtom,
            chainAtom, chainWriteAtom, chainPatchRowAtom, refreshChainResultsAtom, popChainAtom, cancelChainAtom, startReparentAtom, clearChainAtom,
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
