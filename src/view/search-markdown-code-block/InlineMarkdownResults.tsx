import React, { useCallback } from "react";
import { advancedSearch, ResultNode, searchIndex } from "../../search/search";
import { MarkdownContextSettings } from "./markdown-code-block";
import { useAtom, useAtomValue } from "jotai";
import { separatorAtom } from "../react-context/settings";
import { createScope, molecule } from "bunshi";
import { ScopeProvider, useMolecule } from "bunshi/react";
import { SearchViewMolecule, SearchViewScope } from "../react-context/state";
import { atom } from "jotai/index";
import { withAtomEffect } from "jotai-effect";
import { GlobalAppMolecule } from "../react-context/global";
import { _SearchViewPanelContainer } from "../search-view-panel/SearchViewPanelContainer";
import { KeyComboWrapper } from "../search-common/KeyComboWrapper";
import { SearchViewFlatten } from "../search-common/SearchViewFlatten";

export type InlineMarkdownResultsProps = {
    settings: MarkdownContextSettings
}

export const InlineMarkdownScope = createScope({
    settings: null as any as MarkdownContextSettings
})

export const InlineMarkdownMolecule = molecule((mol, scope) => {
    const { settings } = scope(InlineMarkdownScope)
    const { actualQueryAtom, updateSearchResultsAtom } = mol(SearchViewMolecule)
    const { graphAtom } = mol(GlobalAppMolecule)

    const searchResultsAtom = atom<ResultNode[]>([])

    const searchResultsComputeAtom = withAtomEffect(searchResultsAtom, (get, set) => {
        const query = get(actualQueryAtom)
        const graph = get(graphAtom)
        const separator = get(separatorAtom)


        if (settings.query && settings.inferred) {
            const searchResults = searchIndex(graph.graph, `${settings.query} . ${query}`, separator)
            set(updateSearchResultsAtom, searchResults)
        } else {
            const reference = settings.heading ? `${settings.basename}#${settings.heading}` : `[[${settings.basename}]]`
            const searchResults = advancedSearch(graph.graph, reference,
                `${settings.query} . ${query}`,
                separator)
            console.log("InlineMarkdownResults", searchResults)

            set(updateSearchResultsAtom, searchResults)
        }
    })

    return { searchResultsComputeAtom }
})

export const InlineMarkdownResults = (props: InlineMarkdownResultsProps) => {

    return <ScopeProvider scope={InlineMarkdownScope} value={{ settings: props.settings }}>
        <ScopeProvider scope={SearchViewScope} value={{ name: "inline " + props.settings.basename, isQuickLink: false, showSearch: true, isModal: true }}>
            <KeyComboWrapper>
                <_InlineMarkdownResults {...props} />
            </KeyComboWrapper>
        </ScopeProvider>
    </ScopeProvider>
}

export const _InlineMarkdownResults: React.FC<InlineMarkdownResultsProps> = (props) => {
    const { settings } = props
    const children = settings.heading ? settings.basename + ' > ' + settings.heading : settings.basename;

    let sectionName = children + " Children"

    sectionName = [settings.name, sectionName].filter(Boolean).join(" > ")

    const { searchResultsComputeAtom } = useMolecule(InlineMarkdownMolecule)

    useAtom(searchResultsComputeAtom)

    return <>
        <h5>{sectionName}</h5>
        <SearchViewFlatten />
    </>
};





