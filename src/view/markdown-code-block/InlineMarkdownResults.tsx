import { TFile } from "obsidian";
import React, { useCallback } from "react";
import { advancedSearch } from "../../search";
import SearchPage from "../SearchPage";
import { MarkdownContextSettings } from "./ContextCodeBlock";
import { getDefaultStore, useAtomValue } from "jotai";
import { graphAtom, graphVersionAtom } from "../react-context/state";

export type InlineMarkdownResultsProps = {
    settings: MarkdownContextSettings
}

export const InlineMarkdownResults: React.FC<InlineMarkdownResultsProps> = (props) => {
    const {settings} = props
    const graph = useAtomValue(graphAtom, {store: getDefaultStore()})
    const version = useAtomValue(graphVersionAtom, {store: getDefaultStore()})
    const file = settings.file || settings.inferredFile

    const children = settings.heading ? file.basename + ' > ' + settings.heading : file.basename;

    const search = useCallback((query: string) => {
        const searchResults = advancedSearch(graph.graph, file,
            1000,
            settings.heading,
            settings.query || query)

        return searchResults
    }, [version, file, settings.heading, settings.query])

    return <>
        <SearchPage searchFn={search} maxExpand={props.settings.depth} sectionName={children + " Children"}/>
    </>
};





