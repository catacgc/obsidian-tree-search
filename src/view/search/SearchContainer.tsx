import {useGraph} from "../react-context/GraphContext";
import {SearchView} from "./SearchView";
import {useSettings} from "../react-context/PluginContext";
import {searchIndex, SearchQuery} from "../../search";
import {useCallback, useEffect} from "react";
import {GraphEvents} from "../obsidian-views/GraphEvents";
import {useApp} from "../react-context/AppContext";


export const SearchContainer = ({refresh = true}: {refresh?: boolean}) => {

    const {graph, version} = useGraph()
    const {searchSeparator} = useSettings()
    const app = useApp()

    useEffect(() => {
        // try refreshing the graph; nodes count is a good proxy
        if (graph.graph.nodes().length > 0 || !refresh) return;

        const interval = setInterval(() => {
            graph.graph.nodes().length === 0 && app.workspace.trigger(GraphEvents.REFRESH_GRAPH);
        }, 2000, 5);

        return () => clearInterval(interval);
    }, [version, refresh]);

    const searchFunction = useCallback((query: SearchQuery) => {
        return searchIndex(graph.graph, query.query, searchSeparator, 5)
    }, [version, searchSeparator])

    return <SearchView minExpand={5} searchFunction={searchFunction} mode={"launcher"}/>
}
