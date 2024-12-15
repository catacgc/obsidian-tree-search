import { useEffect, useState } from "react";
import { SEARCH_ICON } from "src/view/icons";
import { highlightLine } from "../../obsidian-utils";
import { IndexedResult, ResultNode, SearchQuery } from "../../search";
import { SearchPage } from "../SearchPage";
import { GraphEvents } from "../obsidian-views/GraphEvents";
import { useApp } from "../react-context/AppContext";
import { useGraph } from "../react-context/GraphContext";
import { useIsLoading } from "../react-context/GraphContextProvider";
import { useUrlOpener } from "./useUrlOpener";
import { reverseMarkdownParsing } from "src/copy";
import { Notice } from "obsidian";

export type SearchViewProps = {
    searchFunction: (query: SearchQuery) => IndexedResult
    showSearch?: boolean,
    context?: string,
    mode?: "launcher" | "search",
    minExpand?: number,
    pageSize?: number
}

export const SearchView = ({
                               searchFunction,
                               showSearch = true,
                               context = "global",
                               mode = "search",
                               minExpand = 3,
                               pageSize = 20
                           }: SearchViewProps) => {
    const [search, setSearch] = useState("")
    const [indexedResult, setIndexedResult] = useState<IndexedResult>({nodes: [], total: 0})
    const [pages, setPages] = useState(0)
    const {version, graph} = useGraph()
    const isLoading = useIsLoading()
    const app = useApp()
    const [defaultExpandLevel, setDefaultExpandLevel] = useState(minExpand)
    const [userSetExpandLevel, setUserSetExpandLevel] = useState(minExpand)

    const [selectedLine, setSelectedLine] = useState(0);

    const {linkRef, tryOpenUrl} = useUrlOpener()

    // useEffect(() => {
    //     const handleHighlightOpen = async (event: CustomEvent) => {
    //         const node = findNode(selectedLine, indexedResult.nodes);
    //         console.log(event, node);
    //
    //         if (node && app) {
    //             await highlightLine(app, node.attrs.location)
    //         }
    //         // Handle the event (e.g., update state, trigger UI changes, etc.)
    //     };
    //
    //     window.addEventListener('highlight-open', handleHighlightOpen);
    //
    //     return () => {
    //         window.removeEventListener('highlight-open', handleHighlightOpen);
    //     };
    // }, [selectedLine, indexedResult.nodes]);

    const handleCmdEnter = async (event: React.KeyboardEvent<HTMLInputElement>) => {
        const node = findNode(selectedLine, indexedResult.nodes);
        if (node && app) {
            if (event.shiftKey) {
                await highlightLine(app, node.attrs.location)
            } else {
                await tryOpenUrl(app, node)
            }
        }
    };

    const resetCollapse = () => {
        setDefaultExpandLevel(0)
        setUserSetExpandLevel(0)
    }

    const inc = () => {
        setDefaultExpandLevel(ex => ex + 1)
        setUserSetExpandLevel(ex => ex + 1)
    }
    const dec = () => {
        setDefaultExpandLevel(ex => ex - 1 > 0 ? ex - 1 : 0)
        setUserSetExpandLevel(ex => ex - 1 > 0 ? ex - 1 : 0)
    }

    const handleRefresh = () => {
        if (app) {
            app.workspace.trigger(GraphEvents.REFRESH_GRAPH)
        }
    }

    useEffect(() => {
        const results = searchFunction({ query: search });
        setIndexedResult(results)
        setPages(0)

        // this is a bit of magic, but indentation should expand with number of results
        // in order to keep rendering really fast
        // max indentation at 20 results
        // min indentation at 200 resuls
        const renderedExpand = Math.round(Math.max(0, 10 - results.total / 20))
        
        setDefaultExpandLevel(search.length >= 3 ? renderedExpand : userSetExpandLevel)
    }, [search, version, context])

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowUp') {
            setSelectedLine(prevLine => Math.max(prevLine - 1, 0));
            event.preventDefault();
        } else if (event.key === 'ArrowDown') {
            setSelectedLine(prevLine => Math.min(prevLine + 1, indexedResult.total - 1));
            event.preventDefault();
        } else if (event.key === 'Enter') {
            handleCmdEnter(event);

            // Dispatch custom event
            const customEvent = new CustomEvent(GraphEvents.RESULT_SELECTED, {detail: {type: "enter"}});
            window.dispatchEvent(customEvent);
            event.preventDefault();
        } else if (event.key === 'c' && event.ctrlKey) {
            const node = findNode(selectedLine, indexedResult.nodes);
            if (node && app) {
                let line = reverseMarkdownParsing(node.attrs.tokens)

                navigator.clipboard.writeText(line)
                new Notice('Line copied to clipboard');
            }
            event.preventDefault();
        }
    };

    useEffect(() => {
        setSelectedLine(0);
    }, [indexedResult.total]);

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

                    {[...Array(pages + 1)].map((_, page) => (
                        <SearchPage key={page} 
                                    minExpand={defaultExpandLevel}
                                    searchResult={indexedResult.nodes} 
                                    page={page} 
                                    pageSize={pageSize}
                                    selectedLine={selectedLine}
                                    selectHoveredLine={(l) => setSelectedLine(l)}/>
                    ))}

                    {indexedResult.nodes.length > (pages + 1) * pageSize &&
                        <button onClick={() => setPages(pages + 1)}>Next</button>}
                </>
            )}
        </div>
    </>
};

function findNode(selectedLine: number, nodes: ResultNode[]) {
    const find = (nodes: ResultNode[]): ResultNode | null => {
        for (const node of nodes) {
            if (node.index === selectedLine) return node
            const found = find(node.children)
            if (found) return found
        }
        return null
    }

    return find(nodes);
}

