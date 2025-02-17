import { TreeNode } from '../search/SearchViewFlatten'
import { IndexedResult, SearchQuery } from 'src/search'
import { ResultNode } from 'src/search'
import { atom } from 'jotai'
import { NotesGraph } from 'src/graph'
import { TFile } from 'obsidian'
 
export const isGraphLoadingAtom = atom(false)
export const graphAtom = atom<NotesGraph>(new NotesGraph())
export const graphVersionAtom = atom(0)

export const searchQueryAtom = atom<SearchQuery>({query: ""})

export const actualQueryAtom = atom<string>(get => get(searchQueryAtom).query)
export const selectedLineAtom = atom(0)
export const treeNodesAtom = atom<TreeNode[]>([])

export const pageSizeAtom = atom(50)
const visibleNodesAtom = atom((get) => {
    return get(treeNodesAtom)
        .filter(node => node.visible)
})

const pagesAtom = atom(1)
export const renderableTreeNodes = atom((get) => {
    const pageSize = get(pageSizeAtom)
    const pages = get(pagesAtom)
    return get(visibleNodesAtom).slice(0, pages * pageSize)
})

export const searchPlaceholderAtom = atom((get) => {
    const treeNodes = get(treeNodesAtom)
    const graph = get(graphAtom)
    if (treeNodes.length > 0) {
        return `Search ${treeNodes.length} nodes`
    }

    return `Search ${graph.graph.nodes().length} nodes and ${graph.graph.edges().length} edges`
})

export const hasMoreTreeNodesAtom = atom((get) => {
    const pageSize = get(pageSizeAtom)
    const pages = get(pagesAtom)
    return get(visibleNodesAtom).length > pageSize * pages
})

export const incrementPagesAtom = atom(
    null, 
    (get, set) => set(pagesAtom, get(pagesAtom) + 1)
    )

export const selectedNodeAtom = atom<TreeNode | null>(get => get(treeNodesAtom)[get(selectedLineAtom)])

export const updateSearchResultsAtom = atom(null, (get, set, result: ResultNode[]) => {

    const nodes = flattenIndex(result, get(getExpandLevel))

    set(treeNodesAtom, nodes)

    if (get(searchQueryAtom).query) {
        // if there is a query, we want to expand all nodes
        // this is a bit of magic, but indentation should expand with number of results
        // in order to keep rendering really fast
        // max indentation at 20 results
        // min indentation at 200 results
        const dynamicExpand = Math.round(Math.max(0, 10 - nodes.length / 20))
        set(dynamicExpandAtom, dynamicExpand)
    } else {
        // no query, show a default expand for the view
        set(dynamicExpandAtom, -1)
    }

    set(expandVisibleNodesAtom)
    set(selectedLineAtom, 0)
    set(pagesAtom, 1)
})

export const arrowDownAtom = atom(null, (get, set) => {
    const line = get(selectedLineAtom)
    const nodes = get(treeNodesAtom)
    const nextVisible = nodes.slice(line + 1).find(node => node.visible)
    set(selectedLineAtom, nextVisible?.index ?? nodes.length - 1)
})

export const arrowUpAtom = atom(null, (get, set) => {
    const line = get(selectedLineAtom)
    const nodes = get(treeNodesAtom)
    const prevVisible = nodes.slice(0, line).reverse().find(node => node.visible)
    set(selectedLineAtom, prevVisible?.index ?? 0)
})

export const selectHoveredLineAtom = atom(null, (get, set, index: number) => {
    set(selectedLineAtom, index)
})

//  make all children  of the current node visible or invisible
export const expandNodeAtom = atom(null, (get, set, index: number) => {

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

// Create a derived atom that watches for changes
export const setDefaultExpandLevelAtom = atom(
    (get) => get(defaultExpandLevelAtom),
    (get, set, newValue: number) => {
      set(defaultExpandLevelAtom, newValue)
      set(expandVisibleNodesAtom) // Trigger the expand nodes
    }
  )

export const getExpandLevel = atom((get) => {
    if (get(dynamicExpandAtom) > 0) 
        return get(dynamicExpandAtom)
    return get(userExpandLevel) ?? get(defaultExpandLevelAtom)
})

export const incExpandAtom = atom(null, (get, set) => {
    set(userExpandLevel, get(getExpandLevel) + 1)
    set(dynamicExpandAtom, -1)
    set(expandVisibleNodesAtom)
})

export const decExpandAtom = atom(null, (get, set) => {
    set(userExpandLevel, Math.max(0, get(getExpandLevel) - 1))
    set(dynamicExpandAtom, -1)
    set(expandVisibleNodesAtom)
})

export const expandVisibleNodesAtom = atom(null, (get, set) => {
    const level = get(getExpandLevel)
    const treeNodes = get(treeNodesAtom)
    const newNodes = treeNodes.map(it => { return { ...it, ...{ visible: it.indent <= level } } })
    set(treeNodesAtom, newNodes)
})

export const resetCollapseAtom = atom(null, (get, set) => {
    set(userExpandLevel, 0)
    set(dynamicExpandAtom, -1)
    set(expandVisibleNodesAtom)
})

export function flattenIndex(indexed: ResultNode[], defaultIndentLevel = 0): TreeNode[] {
    const result: TreeNode[] = []

    function flatten(nodes: ResultNode[], indent = 0, parentIndex = 0) {
        let index = parentIndex
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
