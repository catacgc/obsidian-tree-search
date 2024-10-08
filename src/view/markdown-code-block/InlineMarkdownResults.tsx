import React, {useCallback, useEffect, useState} from "react";
import {advancedSearch, index, SearchQuery} from "../../search";
import {TFile} from "obsidian";
import {useGraph} from "../react-context/GraphContext";
import {MarkdownContextSettings} from "./ContextCodeBlock";
import {SearchView} from "../search/SearchView";

export type InlineMarkdownResultsProps = {
    activeFile: TFile;
    heading?: string;
    settings: MarkdownContextSettings
}

export const InlineMarkdownResults: React.FC<InlineMarkdownResultsProps> = (props) => {
    const {graph, version} = useGraph()
    const children = props.heading ? props.activeFile.basename + ' > ' + props.heading : props.activeFile.basename;

    const [showSearch, setShowSearch] = useState(false)

    const search = useCallback((query: SearchQuery) => {
        console.log(query)
        const searchResults = advancedSearch(graph.graph, props.activeFile,
            props.settings.depth,
            props.heading,
            query.query)

        return index(searchResults)
    }, [version, props.activeFile, props.heading, showSearch])

    // useEffect(() => {
    //     // trigger rerender
    // }, [showSearch, props.activeFile]);

    return <>
        <div className="tree-search-header-container" onClick={() => setShowSearch(!showSearch)}>
            <div className="tree-search-header">{children} Children</div>
        </div>

        {showSearch ?
            <SearchView searchFunction={search} showSearch={showSearch}></SearchView>
            : <SearchView searchFunction={search} showSearch={showSearch}></SearchView>}
    </>
};




