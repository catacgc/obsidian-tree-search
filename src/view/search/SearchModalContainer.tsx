import {useGraph} from "../react-context/GraphContext";
import {SearchView} from "./SearchView";
import {useSettings} from "../react-context/PluginContext";
import {searchIndex, SearchQuery} from "../../search";
import {useCallback, useEffect} from "react";
import {GraphEvents} from "../obsidian-views/GraphEvents";
import {useApp} from "../react-context/AppContext";
import { Platform } from "obsidian";
import {SearchViewFlatten} from "./SearchViewFlatten";


export const SearchModalContainer = ({refresh = true}: {refresh?: boolean}) => {

    const {graph, version} = useGraph()
    const {searchSeparator} = useSettings()
    const app = useApp()
    const isDesktop = Platform.isDesktop

    useEffect(() => {
        // try refreshing the graph; nodes count is a good proxy
        if (graph.graph.nodes().length > 0 || !refresh) return;

        const interval = setInterval(() => {
            graph.graph.nodes().length === 0 && app.workspace.trigger(GraphEvents.REFRESH_GRAPH);
        }, 2000, 5);

        return () => clearInterval(interval);
    }, [version, refresh]);

    const searchFunction = useCallback((query: SearchQuery) => {
        return searchIndex(graph.graph, query.query, searchSeparator, 20)
    }, [version, searchSeparator])

    return <div className="search-container-modal">
        <div className="search-container-modal-middle">
            <SearchViewFlatten minExpand={5} searchFunction={searchFunction} mode={"launcher"}/>
        </div>
        {isDesktop && <div className="search-container-modal-instructions tree-search-modal-instructions">
            <div className="tree-search-modal-instructions-navigate"><span
                className="tree-search-modal-instructions-key">↑↓</span><span
                className="tree-search-modal-instructions-text">Navigate</span></div>

            <div className="tree-search-modal-instructions-enter"><span
                className="tree-search-modal-instructions-key">↵</span><span
                className="tree-search-modal-instructions-text">Open Url or Note</span></div>

            <div className="tree-search-modal-instructions-enter"><span
                className="tree-search-modal-instructions-key">Shift+↵</span><span
                className="tree-search-modal-instructions-text">Highlight Source</span></div>

            <div className="tree-search-modal-instructions-enter"><span
                className="tree-search-modal-instructions-key">Ctrl+C</span><span
                className="tree-search-modal-instructions-text">Copy to Clipboard</span></div>
        </div>}
    </div>
}
