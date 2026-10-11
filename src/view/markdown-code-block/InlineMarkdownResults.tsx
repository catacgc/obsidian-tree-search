import React from "react";
import {advancedSearch, searchIndex, partitionArchived, parseQuery, extractArchiveReveal} from "@mdtree/core";
import SearchPage from "../SearchPage";
import {MarkdownContextSettings} from "./ContextCodeBlock";
import {useAtomValue} from "jotai";
import {searchFiltersAtom, separatorAtom} from "../react-context/settings";
import {expandFilterRefs} from "../search/search-filter";
import {GlobalAtoms} from "../react-context/global";

export type InlineMarkdownResultsProps = {
    settings: MarkdownContextSettings
}

export const InlineMarkdownResults: React.FC<InlineMarkdownResultsProps> = (props) => {
    const {settings} = props
    const graph = useAtomValue(GlobalAtoms.graphAtom)
    const separator = useAtomValue(separatorAtom)
    const filters = useAtomValue(searchFiltersAtom)
    const index = useAtomValue(GlobalAtoms.indexAtom)

    const children = settings.heading ? settings.basename + ' > ' + settings.heading : settings.basename;
    const sectionName = [settings.name, children + " Children"].filter(Boolean).join(" > ")

    // Results go through SearchPage's own searchFn so they land in the molecule its
    // ScopeProvider creates; a molecule resolved out here was a different instance.
    const search = (query: string) => {
        // `query` (typed in the block's search) arrives expanded from SearchPage.
        const combinedQuery = `${expandFilterRefs(settings.query, filters, separator)} . ${query}`
        const { reveal } = extractArchiveReveal(parseQuery(combinedQuery, separator))
        const rawResults = settings.query && settings.inferred
            ? searchIndex(graph, combinedQuery, separator, index?.searchOptions())
            : advancedSearch(graph, settings.heading ? `${settings.basename}#${settings.heading}` : `[[${settings.basename}]]`, combinedQuery, separator)
        return partitionArchived(rawResults, reveal).visible
    }

    return <SearchPage maxExpand={settings.depth} sectionName={sectionName} searchFn={search}/>
};
