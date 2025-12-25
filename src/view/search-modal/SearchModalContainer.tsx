import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";
import { advancedSearch, searchIndex } from "../../search/search";
import { SearchModalMolecule, SearchViewMolecule, SearchViewScope, } from "../react-context/state";
import { SearchViewFlatten } from "../search-common/SearchViewFlatten";
import { settingsAtom } from "../react-context/settings";
import { Platform } from "obsidian";
import { ScopeProvider, useMolecule } from "bunshi/react";
import { KeyComboWrapper } from "../search-common/KeyComboWrapper";

export const SearchModalContainer = ({ isQuickLink = false }: { isQuickLink?: boolean }) => {

    return <ScopeProvider scope={SearchViewScope} value={{ name: "modal", isQuickLink, showSearch: true, isModal: true }}>
        <KeyComboWrapper>
            <_SearchModalContainer isQuickLink={isQuickLink} />
        </KeyComboWrapper>
    </ScopeProvider>
}

export const _SearchModalContainer = ({ isQuickLink = false }: { isQuickLink?: boolean }) => {

    const { searchResultsComputeAtom } = useMolecule(SearchModalMolecule)

    const height = (Platform.isMobile || Platform.isTablet) ? "100vh" : "calc(100vh * 0.75)"

    useAtom(searchResultsComputeAtom)

    return <div style={{ height: height }}>
        <div className="flex flex-col w-full h-full">
            <SearchViewFlatten />
        </div>
    </div>;
};
