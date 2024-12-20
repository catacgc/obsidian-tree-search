import { useEffect, useState } from "react";
import { SEARCH_ICON } from "src/view/icons";
import { highlightLine } from "../../obsidian-utils";
import {IndexedResult, ResultNode, SearchQuery} from "../../search";
import { SearchPage } from "../SearchPage";
import { GraphEvents } from "../obsidian-views/GraphEvents";
import { useApp } from "../react-context/AppContext";
import { useGraph } from "../react-context/GraphContext";
import { useIsLoading } from "../react-context/GraphContextProvider";
import { useUrlOpener } from "./useUrlOpener";
import { reverseMarkdownParsing } from "src/copy";
import { Notice } from "obsidian";
import {SearchTreeNode} from "../SearchTreeNode";
import {NodeAttributes} from "../../graph";
import {isSetter} from "@typescript-eslint/utils/dist/ast-utils";


export type TreeNode = {
    attrs: NodeAttributes,
    indent: number,
    hasChildren: boolean
    visible: boolean
    selected: boolean
    index: number
}

export type SearchViewFlattenProps = {
    searchFunction: (query: SearchQuery) => IndexedResult
    showSearch?: boolean,
    context?: string,
    mode?: "launcher" | "search",
    minExpand?: number,
    pageSize?: number
}

export const SearchViewFlatten = ({
                               searchFunction,
                               showSearch = true,
                               context = "global",
                               mode = "search",
                               minExpand = 3,
                               pageSize = 100
                           }: SearchViewFlattenProps) => {
    const [search, setSearch] = useState("")
    const [treeNodes, setTreeNodes] = useState<TreeNode[]>([])
    const [pages, setPages] = useState(0)
    const {version, graph} = useGraph()
    const isLoading = useIsLoading()
    const app = useApp()
    const [defaultExpandLevel, setDefaultExpandLevel] = useState(minExpand)

    const [selectedLine, setSelectedLine] = useState(0);

    const {linkRef, tryOpenUrl} = useUrlOpener()

    const handleCmdEnter = async (event: React.KeyboardEvent<HTMLInputElement>) => {
        const node = findNode(selectedLine, treeNodes);
        if (node && app) {
            if (event.shiftKey) {
                await highlightLine(app, node.attrs.location)
            } else {
                await tryOpenUrl(app, node.attrs)
            }
        }
    };

    //  make all children  of the current node visible or invisible
    const handleNodeExpand = (index: number) => {
        const startIndex = treeNodes.findIndex(it => it.index == index)
        if (startIndex == -1) return

        const nodeToExpand = treeNodes[startIndex]
        const level = nodeToExpand.indent + 1

        for (let i = startIndex + 1; i < treeNodes.length; i++) {
            if (treeNodes[i].indent == nodeToExpand.indent) {
                break
            }
            treeNodes[i].visible = treeNodes[i].indent <= level
        }

        setTreeNodes([...treeNodes])

    }

    const setExpandLevel = (level: number) => {
        const newNodes = treeNodes.map(it => { return {...it, ...{visible: it.indent <= level}} })
        setTreeNodes(newNodes)
    }

    const resetCollapse = () => {
        setDefaultExpandLevel(0)
        setExpandLevel(0)
        // setUserSetExpandLevel(0)
    }

    const inc = () => {
        const level = defaultExpandLevel + 1
        setDefaultExpandLevel(level)
        setExpandLevel(level)
    }
    const dec = () => {
        const level = defaultExpandLevel - 1 > 0 ? defaultExpandLevel - 1 : 0
        setDefaultExpandLevel(level)
        setExpandLevel(level)
    }

    const handleRefresh = () => {
        if (app) {
            app.workspace.trigger(GraphEvents.REFRESH_GRAPH)
        }
    }

    useEffect(() => {
        const results = searchFunction({ query: search });

        // this is a bit of magic, but indentation should expand with number of results
        // in order to keep rendering really fast
        // max indentation at 20 results
        // min indentation at 200 resuls
        const renderedExpand = Math.round(Math.max(0, 10 - results.total / 20))

        setTreeNodes(flattenIndex(results, renderedExpand))
        setPages(0)

        setDefaultExpandLevel(search.length >= 3 ? renderedExpand : defaultExpandLevel)
    }, [search, version, context])

    const handleKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowUp') {
            const prevVisible = treeNodes.slice(0, selectedLine).reverse().find(node => node.visible)
            setSelectedLine(prevVisible?.index ?? 0);
            event.preventDefault();
        } else if (event.key === 'ArrowDown') {
            const nextVisible = treeNodes.slice(selectedLine + 1).find(node => node.visible)
            setSelectedLine(nextVisible?.index ?? treeNodes.length - 1);
            event.preventDefault();
        } else if (event.key === 'Enter') {
            await handleCmdEnter(event);

            // Dispatch custom event
            const customEvent = new CustomEvent(GraphEvents.RESULT_SELECTED, {detail: {type: "enter"}});
            window.dispatchEvent(customEvent);
            event.preventDefault();
        } else if (event.key === 'c' && event.ctrlKey) {
            const node = findNode(selectedLine, treeNodes);
            if (node && app) {
                const line = reverseMarkdownParsing(node.attrs.tokens)

                await navigator.clipboard.writeText(line)
                new Notice('Line copied to clipboard');
            }
            event.preventDefault();
        }
    };

    useEffect(() => {
        setSelectedLine(0);
    }, [treeNodes.length]);

    return <>
        {showSearch &&
            <div>
                <div className="search-row search-view-top">
                    <a style={{display: "none"}} target="_blank" ref={linkRef} href="#"></a>
                    <div className="search-input-container global-search-input-container">
                        <input enterKeyHint="search"
                               type="search"
                               spellCheck="false"
                               onChange={ev => setSearch(ev.target.value)}
                               onKeyDown={handleKeyDown}
                               value={search}
                               placeholder={`Search ${graph.graph.nodes().length} nodes and ${graph.graph.edges().length} edges` }/>
                        <div className="search-input-clear-button" aria-label="Clear search"
                             onClick={() => setSearch("")}></div>
                    </div>
                    <div className="float-search-view-switch">
                        <div className="clickable-icon" aria-label="Refresh Tree"
                             onClick={handleRefresh}>
                            <SEARCH_ICON/>
                        </div>
                        <div className="clickable-icon" aria-label="Collapse results" onClick={dec}> - </div>
                        <div className="clickable-icon" aria-label="Collapse to zero" onClick={resetCollapse}> {defaultExpandLevel} </div>
                        <div className="clickable-icon" aria-label="Expand results" onClick={inc}> + </div>
                    </div>
                </div>
            </div>

        }
        <div className="search-results search-view-middle">
            {isLoading ? (
                <div className="loading-dots">
                    <span>.</span><span>.</span><span>.</span>
                </div>
            ) : (
                <>

                    {/*{[...Array(pages + 1)].map((_, page) => (*/}

                                {treeNodes.slice(0, (pages + 1) * pageSize).map((tree, index) => {
                                    if (!tree.visible) return <></>

                                    return <SearchTreeNode node={tree} key={`${index}`}
                                                           selectedLine={selectedLine}
                                                           expandNode={(index) => handleNodeExpand(index)}
                                                           selectHoveredLine={(index) => setSelectedLine(index)} />
                                })}
                    {/*))}*/}


                    {treeNodes.length > (pages + 1) * pageSize &&
                        <button onClick={() => setPages(pages + 1)}>Next</button>}
                </>
            )}
        </div>
    </>
};

function findNode(selectedLine: number, nodes: TreeNode[]): TreeNode {
    // const find = (nodes: ResultNode[]): ResultNode | null => {
    //     for (const node of nodes) {
    //         if (node.index === selectedLine) return node
    //         const found = find(node.children)
    //         if (found) return found
    //     }
    //     return null
    // }

    return nodes[selectedLine];
}

export function flattenIndex(indexed: IndexedResult, defaultIndentLevel = 0): TreeNode[] {
    const result: TreeNode[] = []

    function flatten(nodes: ResultNode[], indent = 0, parentIndex = 0) {
        let index = parentIndex
        for (const node of nodes) {
            result.push({
                attrs: node.attrs,
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

    flatten(indexed.nodes)
    return result
}
