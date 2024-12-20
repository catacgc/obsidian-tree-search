/**
 * Utility component to render any plugin view
 */
import {AppContext} from "./AppContext";
import {StrictMode} from "react";
import {App} from "obsidian";

export type GraphContextProps = {
    app: App
    children: React.ReactNode
}

export const GraphContextProvider = ({app, children}: GraphContextProps) => {

    return <StrictMode>
        <AppContext.Provider value={app}>
            {children}
        </AppContext.Provider>
    </StrictMode>
}
