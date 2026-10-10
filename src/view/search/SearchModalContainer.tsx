import {useEffect} from "react";
import {useAtom, useAtomValue} from "jotai";
import {SearchModalMolecule, SearchViewMolecule, SearchViewScope} from "../react-context/state";
import {SearchViewFlatten} from "./SearchViewFlatten";
import {ScopeProvider, useMolecule} from "bunshi/react";
import {KeyComboWrapper} from "./KeyComboWrapper";
import {QuickAddView} from "../editor/QuickAddView";

export type SearchModalKind = "search" | "insertLink" | "quickAdd"

/** onTitle: sets the hosting modal's title (the Search modal follows searchModalTitleAtom). */
export const SearchModalContainer = ({ kind, onTitle }: { kind: SearchModalKind; onTitle?: (title: string) => void }) => {

    return <ScopeProvider scope={SearchViewScope} value={{
        name: kind === "quickAdd" ? "quickAdd" : "modal",
        isQuickLink: kind === "insertLink",
        isQuickAdd: kind === "quickAdd",
        // Quick Add keeps showSearch: its link list selects row 0 like a search result list.
        showSearch: true,
        isModal: true,
        allowTimeline: kind === "search",
        allowEditing: kind === "search",
    }}>
        {kind === "quickAdd"
            ? <QuickAddView/>
            : <KeyComboWrapper>
                <_SearchModalContainer onTitle={onTitle}/>
            </KeyComboWrapper>}
    </ScopeProvider>
}

export const _SearchModalContainer = ({ onTitle }: { onTitle?: (title: string) => void }) => {

    const { searchResultsComputeAtom } = useMolecule(SearchModalMolecule)
    const { searchModalTitleAtom } = useMolecule(SearchViewMolecule)
    const title = useAtomValue(searchModalTitleAtom)

    useAtom(searchResultsComputeAtom)
    useEffect(() => { if (title !== null) onTitle?.(title) }, [title])

    return <div className="tree-search-modal-body">
            <div className="flex flex-col w-full h-full">
                <SearchViewFlatten/>
            </div>
        </div>;
};
