import React, {useCallback} from "react";
import {advancedSearch, ResultNode, searchIndex} from "../../search/search";
import SearchPage from "../SearchPage";
import {MarkdownContextSettings} from "./ContextCodeBlock";
import {useAtom, useAtomValue} from "jotai";
import {separatorAtom} from "../react-context/settings";
import {GlobalAtoms} from "../react-context/global";
import {createScope, molecule} from "bunshi";
import {ScopeProvider, useMolecule} from "bunshi/react";
import {SearchViewMolecule, SearchViewScope} from "../react-context/state";
import {atom} from "jotai/index";
import {withAtomEffect} from "jotai-effect";

export type InlineMarkdownResultsProps = {
    settings: MarkdownContextSettings
}

export const InlineMarkdownScope = createScope({
    settings: null as any as MarkdownContextSettings
})

export const InlineMarkdownMolecule = molecule((mol, scope) => {
    const {settings} = scope(InlineMarkdownScope)
    const scp = scope(SearchViewScope)
    const searchMol = mol(SearchViewMolecule)


    const searchResultsAtom = atom<ResultNode[]>([])

    const searchResultsComputeAtom = withAtomEffect(searchResultsAtom, (get, set) => {
        const query = get(searchMol.actualQueryAtom)
        const graph = get(GlobalAtoms.graphAtom)
        const separator = get(separatorAtom)

        console.log(settings, scp)

        if (settings.query && settings.inferred) {
            const searchResults = searchIndex(graph.graph, `${settings.query} . ${query}`, separator)
            set(searchMol.updateSearchResultsAtom, searchResults)
        } else {
            const reference = settings.heading ? `${settings.basename}#${settings.heading}` : `[[${settings.basename}]]`
            const searchResults = advancedSearch(graph.graph, reference,
                `${settings.query} . ${query}`,
                separator)
            set(searchMol.updateSearchResultsAtom, searchResults)
        }
    })

    return { searchResultsComputeAtom }
})

export const InlineMarkdownResults: React.FC<InlineMarkdownResultsProps> = (props) => {
    const {settings} = props
    // const graph = useAtomValue(GlobalAtoms.graphAtom)
    // const version = useAtomValue(GlobalAtoms.graphVersionAtom)
    // const separator = useAtomValue(separatorAtom)
    const children = settings.heading ? settings.basename + ' > ' + settings.heading : settings.basename;

    let sectionName = children + " Children"
    // let search = useCallback((query: string) => {
    //     const reference = settings.heading ? `${settings.basename}#${settings.heading}` : `[[${settings.basename}]]`
    //     const searchResults = advancedSearch(graph.graph, reference,
    //         `${settings.query} . ${query}`,
    //         separator)
    //
    //     return searchResults
    // }, [version, settings.basename, settings.heading, settings.query])
    //
    // if (settings.query && settings.inferred) {
    //     sectionName = "Search Results: " + settings.query
    //     search = useCallback((query: string) => {
    //         const searchResults = searchIndex(graph.graph, `${settings.query} . ${query}`, separator)
    //
    //         return searchResults
    //     }, [version, settings.query])
    // }

    sectionName = [settings.name, sectionName].filter(Boolean).join(" > ")

    const { searchResultsComputeAtom } = useMolecule(InlineMarkdownMolecule,
        {withScope:
                [InlineMarkdownScope, props]
        })

    useAtom(searchResultsComputeAtom)

    return <>
        <ScopeProvider scope={InlineMarkdownScope} value={props}>
            <SearchPage maxExpand={props.settings.depth} sectionName={sectionName}/>
        </ScopeProvider>
    </>
};





