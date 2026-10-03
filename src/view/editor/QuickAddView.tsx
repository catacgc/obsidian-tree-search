// Quick Add's body: the inline editor (Append draft or an Alt-Edit session) with its
// `[[` autocomplete drawn as link-target search results below it (LinkResults).
import React from "react";
import {useAtom, useAtomValue} from "jotai";
import {useMolecule} from "bunshi/react";
import {SearchModalMolecule} from "../react-context/state";
import {EditorMolecule} from "./EditorMolecule";
import {InlineEditor} from "./InlineEditor";

export const QuickAddView = () => {
    // Computes the link-target tree for the scope's query, which InlineEditor sets to the open `[[query`.
    useAtom(useMolecule(SearchModalMolecule).searchResultsComputeAtom)
    const state = useAtomValue(useMolecule(EditorMolecule).editorStateAtom)

    return <div className="tree-search-modal-body">
        <div className="flex flex-col w-full h-full">
            {state && <InlineEditor key={state.sessionId} state={state}/>}
        </div>
    </div>
}
