/**
 * Utility component to render any plugin view
 */
import { StrictMode } from "react";
import { ScopeProvider, useMolecule } from "bunshi/react";
// import { GlobalAppScope } from "./state";
import { GlobalAppMolecule, GlobalStore } from "./global";
import { Provider } from "jotai";

export type GraphContextProps = {
    store: GlobalStore
    children: React.ReactNode
}

export const GraphContextProvider = ({ store, children }: GraphContextProps) => {
    const { appAtom } = useMolecule(GlobalAppMolecule)

    return <StrictMode>
        <Provider store={store}>
            {/* <ScopeProvider scope={GlobalAppScope} value={{ obsidianApp: store.get(appAtom) }} uniqueValue={true}> */}
            {children}
            {/* </ScopeProvider> */}
        </Provider>
    </StrictMode>
}
