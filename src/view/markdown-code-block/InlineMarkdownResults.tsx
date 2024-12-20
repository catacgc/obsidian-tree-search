import { TFile } from "obsidian";
import React, { useCallback } from "react";
import { advancedSearch } from "../../search";
import SearchPage from "../SearchPage";
import { MarkdownContextSettings } from "./ContextCodeBlock";
import { getDefaultStore, useAtomValue } from "jotai";
import { graphAtom, graphVersionAtom } from "../react-context/state";

export type InlineMarkdownResultsProps = {
    activeFile: TFile;
    heading?: string;
    settings: MarkdownContextSettings
}

export const InlineMarkdownResults: React.FC<InlineMarkdownResultsProps> = (props) => {
    const graph = useAtomValue(graphAtom, {store: getDefaultStore()})
    const version = useAtomValue(graphVersionAtom, {store: getDefaultStore()})

    const children = props.heading ? props.activeFile.basename + ' > ' + props.heading : props.activeFile.basename;

    const search = useCallback((query: string) => {
        const searchResults = advancedSearch(graph.graph, props.activeFile,
            1000,
            props.heading,
            query)

        return searchResults
    }, [version, props.activeFile, props.heading])

    return <>
        <SearchPage searchFn={search} maxExpand={props.settings.depth} sectionName={children + " Children"}/>
    </>
};





