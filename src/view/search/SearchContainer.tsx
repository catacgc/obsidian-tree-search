import {useGraph} from "../react-context/GraphContext";
import {SearchView} from "./SearchView";
import {useSettings} from "../react-context/PluginContext";
import {searchIndex, SearchQuery} from "../../search";
import {useCallback, useEffect} from "react";
import {GraphEvents} from "../obsidian-views/GraphEvents";
import {useApp} from "../react-context/AppContext";


export const SearchContainer = ({refresh = false}: {refresh?: boolean}) => {

    const {graph, version} = useGraph()
    const {searchSeparator} = useSettings()
    const app = useApp()

    useEffect(() => {
        // try refreshing the graph
        if (version > 0 || !refresh) return;

        const interval = setInterval(() => {
            version === 0 && app.workspace.trigger(GraphEvents.REFRESH_GRAPH);
        }, 2000, 20);

        return () => clearInterval(interval);
    }, [version, refresh]);

    const searchFunction = useCallback((query: SearchQuery) => {
        return searchIndex(graph.graph, query.query, searchSeparator)
    }, [version, searchSeparator])

    return <SearchView searchFunction={searchFunction}/>
}
