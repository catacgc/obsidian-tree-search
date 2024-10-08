import {useEffect, useState} from "react";
import {IndexedResult, ResultNode, SearchQuery} from "../../search";
import {SearchPage} from "../SearchPage";
import {useApp} from "../react-context/AppContext";
import {highlightLine} from "../../obsidian-utils";
import {SEARCH_ICON} from "src/view/icons";
import {useGraph} from "../react-context/GraphContext";
import {useIsLoading} from "../react-context/GraphContextProvider";
import {GraphEvents} from "../obsidian-views/GraphEvents";
import {useUrlOpener} from "./useUrlOpener";
import {Instructions} from "./Instructions";

export type SearchViewProps = {
    searchFunction: (query: SearchQuery) => IndexedResult
    showSearch?: boolean,
    context?: string,
    mode?: "launcher" | "search"
}

export const SearchView = ({
                               searchFunction,
                               showSearch = true,
                               context = "global",
                               mode = "search"
                           }: SearchViewProps) => {
    const [search, setSearch] = useState("")
    const [indexedResult, setIndexedResult] = useState<IndexedResult>({nodes: [], total: 0})
    const [pages, setPages] = useState(0)
    const {version} = useGraph()
    const isLoading = useIsLoading()
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
            if (event.shiftKey) {
                await highlightLine(app, node.attrs.location)
            } else {
                await tryOpenUrl(app, node)
            }
        }
    };

    const handleRefresh = () => {
        if (app) {
            app.workspace.trigger(GraphEvents.REFRESH_GRAPH)
        }
    }

    useEffect(() => {
        setIndexedResult(searchFunction({query: search}))
        setPages(0)
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
        }
    };

    useEffect(() => {
        setSelectedLine(0);
    }, [indexedResult.total]);

    return <>
        <div className="flex-container">
            <div className="flex-main">
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
                                <SearchPage key={page} searchResult={indexedResult.nodes} page={page} pageSize={10}
                                            selectedLine={selectedLine}
                                            selectHoveredLine={(l) => setSelectedLine(l)}/>
                            ))}

                            {indexedResult.nodes.length > (pages + 1) * 10 &&
                                <button onClick={() => setPages(pages + 1)}>Next</button>}
                        </>
                    )}
                </div>
            </div>
            <Instructions></Instructions>
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




