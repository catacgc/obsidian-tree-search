import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";
import { advancedSearch, searchIndex } from "../../search/search";
import { SearchModalMolecule, SearchViewMolecule, SearchViewScope, } from "../react-context/state";
import { SearchViewFlatten } from "../search-common/SearchViewFlatten";
import { settingsAtom } from "../react-context/settings";
import { Platform } from "obsidian";
import { ScopeProvider, useMolecule } from "bunshi/react";
import { } from "../react-context/global";
import { KeyComboWrapper } from "../search-common/KeyComboWrapper";

export const SearchViewPanelContainer = () => {

    return <ScopeProvider scope={SearchViewScope} value={{ name: "searchpanel", isQuickLink: false, showSearch: true, isModal: true }}>
        <KeyComboWrapper>
            <_SearchViewPanelContainer />
        </KeyComboWrapper>
    </ScopeProvider>
}

export const _SearchViewPanelContainer = () => {

    const { searchResultsComputeAtom } = useMolecule(SearchModalMolecule)

    useAtom(searchResultsComputeAtom)

    return <div style={{ height: "100vh" }}>
        <div className="flex flex-col w-full h-full">
            <SearchViewFlatten />
        </div>
    </div>;
};
