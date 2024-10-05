import {useEffect, useRef, useState} from "react";
import {IndexedResult, ResultNode, searchIndex} from "../../search";
import {SearchPage} from "../SearchPage";
import {usePluginContext} from "../react-context/PluginContext";
import {useApp} from "../react-context/AppContext";
import {highlightLine, openFileByName, selectLine} from "../../obsidian-utils";
import {SEARCH_ICON, SETTINGS_ICON} from "src/view/icons";
import {App} from "obsidian";
import {useGraph} from "../react-context/GraphContext";
import {useIsLoading} from "../react-context/GraphContextProvider";
import {GraphEvents} from "../obsidian-views/GraphEvents";
import {useUrlOpener} from "./useUrlOpener";


export const SearchView = () => {
    const [search, setSearch] = useState("")
    const [indexedResult, setIndexedResult] = useState<IndexedResult>({nodes: [], total: 0})
    const [pages, setPages] = useState(0)
    const {graph, version} = useGraph()
    const isLoading = useIsLoading()
    const context = usePluginContext()
    const app = useApp()

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
            if (event.ctrlKey || event.metaKey) {
                setSelectedLine(-1)
                await selectLine(app, node.attrs.location)
            }
            if (event.shiftKey) {
                await tryOpenUrl(app, node)
            } else {
                await highlightLine(app, node.attrs.location)
            }
        }
    };

    const handleRefresh = () => {
        if (app) {
            app.workspace.trigger(GraphEvents.REFRESH_GRAPH)
        }
    }

    useEffect(() => {
        setIndexedResult(searchIndex(graph.graph, search, context.settings.searchSeparator))
        setPages(0)
    }, [search, graph, version])

    useEffect(() => {
        // try refreshing the graph
        if (version > 0) return;

        const interval = setInterval(() => {
            version === 0 && app?.workspace.trigger(GraphEvents.REFRESH_GRAPH);
        }, 2000, 20);

        return () => clearInterval(interval);
    }, [version]);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowUp') {
            setSelectedLine(prevLine => Math.max(prevLine - 1, 0));
            event.preventDefault();
        } else if (event.key === 'ArrowDown') {
            setSelectedLine(prevLine => Math.min(prevLine + 1, indexedResult.total - 1));
            event.preventDefault();
        } else if (event.key === 'Enter') {
            handleCmdEnter(event);
            event.preventDefault();
        }
    };

    useEffect(() => {
        setSelectedLine(0);
    }, [indexedResult.total]);

    return <div className={"search-view"}>
        <a style={{display: "none"}} target="_blank" ref={linkRef} href="#"></a>
        <div className="search-row">
            <div className="search-input-container global-search-input-container">
                <input enterKeyHint="search"
                       type="search"
                       spellCheck="false"
                       onChange={ev => setSearch(ev.target.value)}
                       onKeyDown={handleKeyDown}
                       value={search}
                       placeholder="Search..."/>
                <div className="search-input-clear-button" aria-label="Clear search"
                     onClick={() => setSearch("")}></div>
            </div>
            <div className="float-search-view-switch">
                <div className="clickable-icon" aria-label="Refresh Tree"
                     onClick={handleRefresh}>
                    <SEARCH_ICON/>
                </div>
                {/*<div className="clickable-icon" aria-label="Search settings">*/}
                {/*    <SETTINGS_ICON/>*/}
                {/*</div>*/}
            </div>

        </div>


        <div className="search-results">
            {isLoading ? (
                <div className="loading-dots">
                    <span>.</span><span>.</span><span>.</span>
                </div>
            ) : (
                <>

                    {[...Array(pages + 1)].map((_, page) => (
                        <SearchPage key={page} searchResult={indexedResult.nodes} page={page} pageSize={10}
                                    selectedLine={selectedLine}
                                    selectHoveredLine={(l) => setSelectedLine(l)}/>
                    ))}

                    {indexedResult.nodes.length > (pages + 1) * 10 &&
                        <button onClick={() => setPages(pages + 1)}>Next</button>}
                </>
            )}
        </div>

        <div className="tree-search-help">
            <i><b>Enter</b>: highlight | <b>Cmd+Enter</b>: select | <b>Shift+Enter</b>: open URL</i>
        </div>
    </div>
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




