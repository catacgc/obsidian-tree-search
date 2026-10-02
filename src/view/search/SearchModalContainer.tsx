import {useAtom} from "jotai";
import {SearchModalMolecule, SearchViewScope} from "../react-context/state";
import {SearchViewFlatten} from "./SearchViewFlatten";
import {ScopeProvider, useMolecule} from "bunshi/react";
import {KeyComboWrapper} from "./KeyComboWrapper";

export const SearchModalContainer = ({ isQuickLink = false }: { isQuickLink?: boolean }) => {

    return <ScopeProvider scope={SearchViewScope} value={{name: "modal", isQuickLink, showSearch: true, isModal: true, allowTimeline: !isQuickLink, allowEditing: !isQuickLink}}>
        <KeyComboWrapper>
            <_SearchModalContainer isQuickLink={isQuickLink}/>
        </KeyComboWrapper>
    </ScopeProvider>
}

export const _SearchModalContainer = ({ isQuickLink = false }: { isQuickLink?: boolean }) => {

    const { searchResultsComputeAtom } = useMolecule(SearchModalMolecule)

    useAtom(searchResultsComputeAtom)

    return <div className="tree-search-modal-body">
            <div className="flex flex-col w-full h-full">
                <SearchViewFlatten/>
            </div>
        </div>;
};
