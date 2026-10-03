import {TreeNode} from '../search/SearchViewFlatten'
import {advancedSearch, flattenTasks, ResultNode, searchIndex, searchParents, parseQuery, linkTargetTree, type QueryExpr, partitionArchived, extractArchiveReveal, suggestAt, type Suggestion, buildTimeline, fileParent, parseDuration, flattenIndex, defaultVisibility} from '@mdtree/core'
import {atom, useAtomValue} from 'jotai'
import {ParsedNode} from '@mdtree/core'

type SearchQuery = { query: string; file?: string; heading?: string }
import {createScope, molecule} from "bunshi";
import {App} from "obsidian";
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

export type TimelineWindow = "all" | "7d" | "30d" | "1y"
export const TIMELINE_WINDOWS: TimelineWindow[] = ["all", "7d", "30d", "1y"]
/** The action panel's list: the main actions, or the Move under… page list. */
export type ActionPanelPage = "main" | "moveUnder"

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

    const lastSearchAtom = atom<SearchQuery>({query: ""})

    return {
        appAtom: GlobalAtoms.appAtom,
        isGraphLoadingAtom: GlobalAtoms.isGraphLoadingAtom,
        searchForActiveFileAtom,
        searchParentsFnAtom,
        searchTasksAtom,
        lastSearchAtom
    }
})

export const SearchModalMolecule = molecule((mol, scope) => {
    const scp = scope(SearchViewScope)
    const searchMol = mol(SearchViewMolecule)

    const searchResultsAtom = atom<ResultNode[]>([])

    const searchResultsComputeAtom = withAtomEffect(searchResultsAtom, (get, set) => {
        get(GlobalAtoms.graphVersionAtom)  // re-run on mutable graph updates from refreshPage
        const searchQuery = get(searchMol.actualQueryAtom)
        const graph = get(GlobalAtoms.graphAtom)
        const separator = get(separatorAtom)

        if (scp.isQuickLink || scp.isQuickAdd) {
            // Insert Link and Quick Add offer only link targets: notes and headers whose
            // own name/alias/heading matches the query, archived rows hidden.
            set(searchMol.updateSearchResultsAtom, linkTargetTree(graph, searchQuery, separator), 0)
            return
        }

        const searchResults = searchIndex(graph, searchQuery, separator)

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

    const searchQueryAtom = atomWithDefault<SearchQuery>(get => {
        if (scp.isModal) {
            return get(lastSearchAtom)
        }

        return {query: ""}
    })

    const actualQueryAtom = atom<string>(get => get(searchQueryAtom).query)
    const selectedLineAtom = atom(-1)
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
        const { totalNodes } = get(searchResultsStateAtom)
        const graph = get(GlobalAtoms.graphAtom)
        if (totalNodes > 0) {
            return `Search ${totalNodes} nodes`
        }

        return `Search ${graph.order} nodes and ${graph.size} edges`
    })

    const incrementPagesAtom = atom(
        null,
        (get, set) => set(pagesAtom, get(pagesAtom) + 1)
    )

    const selectedNodeAtom = atom<TreeNode | null>(get => {
        const sel = get(selectedLineAtom)
        if (sel == -1) return null
        return get(treeNodesAtom)[sel]
    })

    // Per-view (scope name) Tree/Timeline mode, persisted to data.json by main.ts.
    const viewModeAtom = atom<SearchViewMode>(get => get(searchViewModesAtom)[scp.name] ?? "tree")
    const timelineActiveAtom = atom(get => scp.allowTimeline === true && get(viewModeAtom) === "timeline")
    const toggleViewModeAtom = atom(null, (get, set) =>
        set(searchViewModesAtom, {...get(searchViewModesAtom), [scp.name]: get(viewModeAtom) === "timeline" ? "tree" : "timeline"}))
    // View-local recency filter; narrows the timeline without touching the query.
    const timelineWindowAtom = atom<TimelineWindow>("all")
    // Raw results of the last search, kept so mode/window changes can re-project
    // without re-running the search.
    const lastResultsAtom = atom<{ results: ResultNode[]; archivedCount: number }>({ results: [], archivedCount: 0 })

    const updateSearchResultsAtom = atom(null, (get, set, result: ResultNode[], archivedCount: number = 0) => {
        set(lastResultsAtom, { results: result, archivedCount })

        if (get(timelineActiveAtom)) {
            const w = get(timelineWindowAtom)
            // Undated items take the ctime of the file their line lives in
            // (timeline-only; the index itself deliberately ignores fs times).
            // Age counts local calendar days so the row's rebuilt date is exact.
            const app = get(GlobalAtoms.appAtom)
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const fileAgeDays = (n: ParsedNode) => {
                const file = app?.vault.getFileByPath(n.location.path)
                if (!file) return null
                const created = new Date(file.stat.ctime)
                created.setHours(0, 0, 0, 0)
                // round: DST days are 23/25h long
                return Math.max(0, Math.round((today.getTime() - created.getTime()) / 86_400_000))
            }
            const items = buildTimeline(result, get(matchExprsAtom), w === "all" ? null : parseDuration(w), fileAgeDays)
            const graph = get(GlobalAtoms.graphAtom)
            const nodes: TreeNode[] = items.map((item, i) => {
                // Results start at the matched node, so a hit with no matched
                // ancestor shows its in-note parent (e.g. the enclosing header).
                const parent = item.breadcrumb.length === 0 ? fileParent(graph, item.node) : null
                return {
                    node: item.node,
                    indent: 0,
                    hasChildren: false,
                    visible: true,
                    selected: false,
                    index: i,
                    matched: true,
                    archived: item.archived,
                    timeline: { breadcrumb: parent ? [parent] : item.breadcrumb, pinned: item.pinned, ageDays: item.ageDays }
                }
            })
            set(treeNodesAtom, nodes)
            set(selectedLineAtom, get(searchVisibleAtom) ? 0 : -1)
            set(hoveredLineAtom, -1)
            set(pagesAtom, 1)
            return
        }

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

        set(treeNodesAtom, nodesWithVisibility)
        set(selectedLineAtom, searchVisible ? 0 : -1)
        set(hoveredLineAtom, -1)
        set(pagesAtom, 1)
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
        const newNodes = treeNodes.map((it, i) => ({ ...it, visible: visible[i] }))
        set(treeNodesAtom, newNodes)
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
        return suggestAt(query, cursorPos)
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
            arrowUpAtom,
            arrowDownAtom,
            decExpandAtom,
            incExpandAtom,
            resetCollapseAtom,
            selectedNodeAtom,
            searchPlaceholderAtom,
            setDefaultExpandLevelAtom,
            expandNodeAtom, selectedLineAtom, updateHoveredLineAtom, hoveredLineAtom,
            matchTermsAtom,
            matchExprsAtom,
            cursorPosAtom, suggestionsAtom, suggestionIndexAtom, dismissSuggestionsAtom, resetSuggestionsAtom,
            repositionSuggestionsAtom,
            focusSearchInputAtom, appendQueryTokenAtom,
            timelineActiveAtom, toggleViewModeAtom, timelineWindowAtom, rebuildResultsAtom,
            actionPanelAtom, openActionPanelAtom, closeActionPanelAtom, toggleActionPanelAtom,
            allowTimeline: scp.allowTimeline,
            allowEditing: scp.allowEditing,
            isQuickAdd: scp.isQuickAdd
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
