/**
 * Utility component to render any plugin view
 */
import {IndexedTree} from "../../indexed-tree";
import {AppContext, useApp} from "./AppContext";
import {StrictMode, useEffect, useState} from "react";
import {App} from "obsidian";
import {GraphContext} from "./GraphContext";
import {GraphEvents} from "../obsidian-views/GraphEvents";

export type GraphContextProps = {
    index: IndexedTree
    app: App
    children: React.ReactNode
}

export const GraphContextProvider = ({index, app, children}: GraphContextProps) => {

    const [graph, setGraph] = useState(index.getState())
    const [version, setVersion] = useState(0)

    useEffect(() => {
        index.onChange(props => {
            console.debug("Graph update", props.version)
            setGraph(props.graph)
            setVersion(props.version)
            app.workspace.trigger(GraphEvents.FINISHED_LOADING);
        })
    }, [])

    return <StrictMode>
        <AppContext.Provider value={app}>
            <GraphContext.Provider value={{graph, version}}>
                {children}
            </GraphContext.Provider>
        </AppContext.Provider>
    </StrictMode>
}

export const useIsLoading = () => {
    const app = useApp()
    const [isLoading, setIsLoading] = useState(false)

    if (!app) return false

    useEffect(() => {
        // @ts-expect-error
        const on = app.workspace.on(GraphEvents.REFRESH_GRAPH, () => {
            setIsLoading(true)
        })

        // @ts-expect-error
        const off= app.workspace.on(GraphEvents.FINISHED_LOADING, () => {
            setIsLoading(false)
        })

        return () => {
            app.workspace.offref(on)
            app.workspace.offref(off)
        }
    }, [app]);

    return isLoading
}
