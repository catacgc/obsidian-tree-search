import {useAtom} from "jotai";
import {SearchModalMolecule, SearchViewScope} from "../react-context/state";
import {SearchViewFlatten} from "./SearchViewFlatten";
import {ScopeProvider, useMolecule} from "bunshi/react";
import {KeyComboWrapper} from "./KeyComboWrapper";

export type SearchModalKind = "search" | "insertLink" | "quickAdd"

export const SearchModalContainer = ({ kind }: { kind: SearchModalKind }) => {

    return <ScopeProvider scope={SearchViewScope} value={{
        name: kind === "quickAdd" ? "quickAdd" : "modal",
        isQuickLink: kind === "insertLink",
        isQuickAdd: kind === "quickAdd",
        showSearch: true,
        isModal: true,
        allowTimeline: kind !== "insertLink",
        allowEditing: kind !== "insertLink",
    }}>
        <KeyComboWrapper>
            <_SearchModalContainer/>
        </KeyComboWrapper>
    </ScopeProvider>
}

export const _SearchModalContainer = () => {

    const { searchResultsComputeAtom } = useMolecule(SearchModalMolecule)

    useAtom(searchResultsComputeAtom)

    return <div className="tree-search-modal-body">
            <div className="flex flex-col w-full h-full">
                <SearchViewFlatten/>
            </div>
        </div>;
};
