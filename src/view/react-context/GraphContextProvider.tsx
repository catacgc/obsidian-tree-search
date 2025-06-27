/**
 * Utility component to render any plugin view
 */
import {StrictMode} from "react";
import {ScopeProvider} from "bunshi/react";
import {GlobalAppScope} from "./state";
import {GlobalAtoms, GlobalStore} from "./global";
import {Provider} from "jotai";

export type GraphContextProps = {
    store: GlobalStore
    children: React.ReactNode
}

export const GraphContextProvider = ({store, children}: GraphContextProps) => {

    return <StrictMode>
        <Provider store={store}>
            <ScopeProvider scope={GlobalAppScope} value={{obsidianApp: store.get(GlobalAtoms.appAtom)}} uniqueValue={true}>
                {children}
            </ScopeProvider>
        </Provider>
    </StrictMode>
}
