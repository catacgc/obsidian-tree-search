import { TFile } from "obsidian";
import React, { useCallback } from "react";
import { advancedSearch, searchIndex } from "../../search";
import SearchPage from "../SearchPage";
import { MarkdownContextSettings } from "./ContextCodeBlock";
import { getDefaultStore, useAtomValue } from "jotai";
import { graphAtom, graphVersionAtom } from "../react-context/state";
import { separatorAtom } from "../react-context/settings";

export type InlineMarkdownResultsProps = {
    settings: MarkdownContextSettings
}

export const InlineMarkdownResults: React.FC<InlineMarkdownResultsProps> = (props) => {
    const {settings} = props
    const graph = useAtomValue(graphAtom, {store: getDefaultStore()})
    const version = useAtomValue(graphVersionAtom, {store: getDefaultStore()})
    const separator = useAtomValue(separatorAtom)
    const children = settings.heading ? settings.basename + ' > ' + settings.heading : settings.basename;

    let sectionName = children + " Children"
    let search = useCallback((query: string) => {
        const reference = settings.heading ? `${settings.basename}#${settings.heading}` : `[[${settings.basename}]]`
        const searchResults = advancedSearch(graph.graph, reference,
            `${settings.query} . ${query}`,
            separator)

        return searchResults
    }, [version, settings.basename, settings.heading, settings.query])

    if (settings.query && settings.inferred) {
        sectionName = "Search Results: " + settings.query
        search = useCallback((query: string) => {
            const searchResults = searchIndex(graph.graph, `${settings.query} . ${query}`, separator)
    
            return searchResults
        }, [version, settings.query])
    }

    sectionName = [settings.name, sectionName].filter(Boolean).join(" > ")

    return <>
        <SearchPage searchFn={search} maxExpand={props.settings.depth} sectionName={sectionName}/>
    </>
};





