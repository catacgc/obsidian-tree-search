import { TreeNode } from '../search-common/SearchViewFlatten'
import { advancedSearch, flattenTasks, getAllFoldersTree, ResultNode, searchIndex, searchParents, SearchQuery } from '../../search/search'
import { atom, useAtomValue } from 'jotai'
import { ParsedNode, ParsedTextToken, TextNode, TextTokenWithLocationLink } from '../../graph'
import { ComponentScope, createScope, molecule, onMount, onUnmount } from "bunshi";
import { separatorAtom } from "./settings";
import { atomWithDefault } from "jotai/utils";
import { withAtomEffect } from "jotai-effect";
import { GlobalAppMolecule } from './global';

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
    scopeName: { name: string, instance: number }
}

export type SearchQueryBuilderBase = {
    viewType: "activeFile" | "parents" | "tasks" | "modal"
}

export type ModalQuery = {
    viewType: "modal"
}

export type SearchQueryBuilder = SearchQueryBuilderBase & (ModalQuery)

// export const GlobalAppScope = createScope<{
//     obsidianApp: App
// }>({
//     obsidianApp: null as any as App
// })

export const SearchViewScope = createScope({
    name: "default",
    isQuickLink: false,
    showSearch: true,
    isModal: true
})

export const GlobalSearchMolecule = molecule((mol, scope) => {
    const { graphAtom, activeFileAtom, graphVersionAtom } = mol(GlobalAppMolecule)

    const searchForActiveFileAtom = atom((get) => {
        const graph = get(graphAtom)
        const activeFile = get(activeFileAtom)
        const separator = get(separatorAtom)

        return (query: string) => {
            console.debug("Search again for active file", get(graphVersionAtom), activeFile?.name)

            if (activeFile === undefined) {
                return []
            }

            return advancedSearch(
                graph.graph,
                `[[${activeFile.basename}]]`.toLowerCase(),
                query,
                separator
            )
        }
    })

    const searchParentsFnAtom = atom((get) => {
        const graph = get(graphAtom)
        const activeFile = get(activeFileAtom)

        return (q: string) => {
            if (activeFile === undefined) {
                return []
            }

            return searchParents(graph.graph, activeFile)
        }
    })

    const searchTasksAtom = atom((get) => {
        const graph = get(graphAtom)
        const activeFile = get(activeFileAtom)
        const separator = get(separatorAtom)

        return (query: string) => {
            if (activeFile === undefined) {
                return []
            }

            const searchResults = advancedSearch(
                graph.graph,
                `[[${activeFile.basename}]]`.toLowerCase(),
                query,
                separator
            )

            return flattenTasks(searchResults).nodes
        }
    })

    return {
        searchForActiveFileAtom,
        searchParentsFnAtom,
        searchTasksAtom,
    }
})

export const SearchModalMolecule = molecule((mol, scope) => {
    const scp = scope(SearchViewScope)
    const searchMol = mol(SearchViewMolecule)

    const { graphAtom, graphVersionAtom, random } = mol(GlobalAppMolecule)

    const searchResultsAtom = atom<ResultNode[]>([])

    const searchResultsComputeAtom = withAtomEffect(searchResultsAtom, (get, set) => {
        const searchQuery = get(searchMol.actualQueryAtom)
        const isQuickLink = scp.isQuickLink
        const graph = get(graphAtom)
        const version = get(graphVersionAtom)
        console.log("Graph", graph.graph.nodes().length, version, random)
        const separator = get(separatorAtom)

        if (!searchQuery) {
            const allFolders = getAllFoldersTree(graph.graph)
            set(searchMol.updateSearchResultsAtom, allFolders)
            return
        }

        const search = (isQuickLink && searchQuery.length > 0) ? `${searchQuery} . : page | : header` : searchQuery

        const searchResults = searchIndex(graph.graph, search, separator)
        set(searchMol.updateSearchResultsAtom, searchResults)
    })

    return { searchResultsComputeAtom }
})

export const ExpandFunctionsMolecule = molecule((mol, scope) => {
    scope(SearchViewScope)
    const { treeNodesAtom, treeNodesInstance } = mol(TreeNodesMolecule)
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

    const resetCollapseAtom = atom(null, (get, set) => {
        set(userExpandLevel, 0)
        set(dynamicExpandAtom, -1)
        set(expandVisibleNodesAtom)
    })

    const expandVisibleNodesAtom = atom(null, (get, set) => {
        const level = get(getExpandLevel)
        const treeNodes = get(treeNodesAtom)
        const newNodes = treeNodes.map(it => { return { ...it, ...{ visible: it.indent <= level } } })
        set(treeNodesAtom, newNodes)
    })

    //  make all children  of the current node visible or invisible
    const expandNodeAtom = atom(null, (get, set, index: number) => {

        const treeNodes = get(treeNodesAtom)
        console.log("Expand node", treeNodesInstance, treeNodes)
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

        console.log("Expand node", index, treeNodes)

        set(treeNodesAtom, [...treeNodes])
    })

    return {
        getExpandLevel,
        setDefaultExpandLevelAtom,
        expandVisibleNodesAtom,
        incExpandAtom,
        decExpandAtom,
        resetCollapseAtom,
        dynamicExpandAtom,
        expandNodeAtom
    }
})

export const TreeNodesMolecule = molecule((mol, scope) => {
    scope(SearchViewScope)
    const treeNodesAtom = atom<TreeNode[]>([])
    const debug = Math.random()

    onMount(() => console.log("Mount", debug))
    onUnmount(() => console.log("Unmount", debug))

    return { treeNodesAtom, treeNodesInstance: debug }
})

export const SearchViewMolecule = molecule((mol, scope) => {
    const scp = scope(SearchViewScope)
    const expandMol = mol(ExpandFunctionsMolecule)
    const { treeNodesAtom, treeNodesInstance } = mol(TreeNodesMolecule)

    const instance = Math.random()

    const { graphAtom, graphVersionAtom, isGraphLoadingAtom } = mol(GlobalAppMolecule)
    const lastSearchAtom = atom<SearchQuery>({ query: "" })

    const searchQueryAtom = atomWithDefault<SearchQuery>(get => {
        if (scp.isModal) {
            return get(lastSearchAtom)
        }

        return { query: "" }
    })

    const actualQueryAtom = atom<string>(get => get(searchQueryAtom).query)
    const selectedLineAtom = atom(-1)
    const searchVisibleAtom = atom(scp.showSearch)
    const hoveredLineAtom = atom(0)

    const pageSizeAtom = atom(50)
    const pagesAtom = atom(1)

    // Combined derived atom to avoid multiple cascading updates
    const searchResultsStateAtom = atom<SearchResultsState>((get) => {
        const treeNodes = get(treeNodesAtom)
        const pageSize = get(pageSizeAtom)
        const pages = get(pagesAtom)

        console.log("Search results state", treeNodes.length, treeNodesInstance)

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
        const isLoading = get(isGraphLoadingAtom)
        const showSearch = get(searchVisibleAtom)
        const version = get(graphVersionAtom)

        return {
            searchResults,
            isLoading,
            showSearch,
            version,
            isQuickLink: scp.isQuickLink,
            scopeName: { name: scp.name, instance: instance }
        }
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

    const updateSearchResultsAtom = atom(null, (get, set, result: ResultNode[]) => {
        console.log("Update search results", scp, result.length, treeNodesInstance)

        // Calculate dynamic expand level first
        const dynamicExpand = get(searchQueryAtom).query
            ? Math.round(Math.max(0, 10 - result.length / 20))
            : -1

        // Set dynamic expand level before getting the expand level
        set(expandMol.dynamicExpandAtom, dynamicExpand)

        // Get the current expand level (which now includes the updated dynamic expand)
        const expandLevel = get(expandMol.getExpandLevel)

        // Flatten nodes with the correct expand level
        const nodes = flattenIndex(result, expandLevel, !!get(searchQueryAtom).query)

        // Apply visibility logic immediately instead of separate update
        const nodesWithVisibility = nodes.map(node => ({
            ...node,
            visible: node.indent <= expandLevel
        }))

        const searchVisible = get(searchVisibleAtom)

        // Try to batch updates by doing them all synchronously
        // This should minimize the number of atom recalculations
        set(treeNodesAtom, nodesWithVisibility)
        set(selectedLineAtom, searchVisible ? 0 : -1)
        set(hoveredLineAtom, -1)
        set(pagesAtom, 1)
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

    return {
        scopeName: { name: scp.name, instance: instance },
        actualQueryAtom,
        searchQueryAtom,
        searchResultsStateAtom,
        searchViewStateAtom,
        incrementPagesAtom,
        searchVisibleAtom,
        updateSearchResultsAtom,
        arrowUpAtom,
        arrowDownAtom,
        selectedNodeAtom,
        treeNodesAtom,
        selectedLineAtom, updateHoveredLineAtom, hoveredLineAtom,
        lastSearchAtom
    }
})



function transformToText(node: ParsedNode): TextNode {
    let tokens: ParsedTextToken[] = []
    switch (node.nodeType) {
        case "page":
            tokens = [
                {
                    tokenType: "obsidian_link",
                    source: node.page,
                    pageTarget: node.page,
                }
            ]
            break
        case "header":
            tokens = [
                {
                    tokenType: "obsidian_link",
                    source: node.header,
                    pageTarget: node.page,
                    headerName: node.header
                }
            ]
            break
        case "text":
            tokens = node.parsedTokens
            break
        case "folderNote":
            tokens = [
                {
                    tokenType: "obsidian_link",
                    source: node.page.page,
                    pageTarget: node.page.page,
                }
            ]
            break
        case "pointer":
            tokens = [
                {
                    tokenType: "text",
                    text: "⚠️ Pointer node",
                    decoration: "none"
                }
            ]
            break
    }

    return {
        nodeType: "text",
        location: node.location,
        parsedTokens: tokens,
        tags: [],
        isTask: false,
        isCompleted: false,
        searchKey: node.searchKey,
        ageDays: node.ageDays,
        boost: node.boost
    }
}

function mergeTokens(node1: TextNode, node2: TextNode): TextNode {
    const separator: TextTokenWithLocationLink = {
        tokenType: "text",
        text: "⇒",
        decoration: "none",
        location: node2.location
    }
    const tokens = [...node1.parsedTokens, separator, ...node2.parsedTokens]
    return {
        nodeType: "text",
        location: node1.location,
        parsedTokens: tokens,
        tags: [],
        ageDays: Math.min(node1.ageDays, node2.ageDays),
        isTask: false,
        isCompleted: false,
        searchKey: node1.searchKey
    }
}

// TODO: merged nodes are not yet ready for "production"
function merge(node1: TreeNode, node2: ParsedNode): TreeNode {
    const existingNode = node1.node

    return {
        node: mergeTokens(transformToText(existingNode), transformToText(node2)),
        indent: node1.indent,
        hasChildren: false,
        visible: true,
        selected: false,
        index: node1.index
    }
}

export function flattenIndex(indexed: ResultNode[], defaultIndentLevel = 0, shouldSort = true): TreeNode[] {
    const result: TreeNode[] = []

    function flatten(unsorted: ResultNode[], indent = 0, parentIndex = 0): number {

        let nodes = unsorted
        if (shouldSort) {
            nodes = unsorted.sort((a, b) => {

                // // Add node-specific boost values if they exist
                let aboost = a.node.boost || 0
                let bboost = b.node.boost || 0
                //
                // // Add other factors
                // aboost += a.children.length
                // bboost += b.children.length
                // aboost -= a.node.searchKey.length
                // bboost -= b.node.searchKey.length

                return bboost - aboost
            })
        }

        let index = parentIndex

        // if (result.length > 0 && nodes.length == 1 /*&& nodes[0].node.nodeType == "page"*/) {
        //     const node = nodes[0]
        //     const isheader = node.node.nodeType == "page" || node.node.nodeType == "header"
        //     if (isheader && node.children.length != 0) {
        //         const lastresult = result[result.length - 1]
        //         result[result.length - 1] = merge(lastresult, node.node)
        //
        //         return flatten(node.children, indent, index)
        //     }
        // }

        for (const node of nodes) {
            result.push({
                node: node.node,
                indent: indent,
                hasChildren: node.children.length > 0,
                visible: indent <= defaultIndentLevel,
                selected: false,
                index: index
            })
            index += 1
            index = flatten(node.children, indent + 1, index)
        }
        return index
    }

    flatten(indexed)

    return result
}
