import {useAtom} from "jotai";
import {SearchModalMolecule, SearchViewScope} from "../react-context/state";
import {SearchViewFlatten} from "./SearchViewFlatten";
import {Platform} from "obsidian";
import {ScopeProvider, useMolecule} from "bunshi/react";
import {KeyComboWrapper} from "./KeyComboWrapper";

export const SearchModalContainer = ({ isQuickLink = false }: { isQuickLink?: boolean }) => {

    return <ScopeProvider scope={SearchViewScope} value={{name: "modal", isQuickLink, showSearch: true, isModal: true}}>
        <KeyComboWrapper>
            <_SearchModalContainer isQuickLink={isQuickLink}/>
        </KeyComboWrapper>
    </ScopeProvider>
}

export const _SearchModalContainer = ({ isQuickLink = false }: { isQuickLink?: boolean }) => {

    const { searchResultsComputeAtom } = useMolecule(SearchModalMolecule)

    const height = (Platform.isMobile || Platform.isTablet) ? "100vh" : "calc(100vh * 0.75)"

    useAtom(searchResultsComputeAtom)

    return <div style={{height: height}}>
            <div className="flex flex-col w-full h-full">
                <SearchViewFlatten/>
            </div>
        </div>;
};
