import React from "react";
import { SEARCH_ICON } from "../icons";
import { highlightLine, insertHere, insertLine } from "../../obsidian-utils";
import { GraphEvents } from "../obsidian-views/GraphEvents";
import { useApp } from "../react-context/AppContext";
import { useUrlOpener } from "./useUrlOpener";
import { reverseMarkdownParsing } from "../copy";
import { Notice } from "obsidian";
import { SearchTreeNode } from "../SearchTreeNode";
import { ParsedNode } from "../../graph";
import { arrowDownAtom, arrowUpAtom, decExpandAtom, graphAtom, incExpandAtom, isGraphLoadingAtom, resetCollapseAtom, searchQueryAtom, selectedNodeAtom, getExpandLevel, searchPlaceholderAtom } from "../react-context/state";
import { useAtom, useAtomValue, useSetAtom } from "jotai";

export type SearchBarProps = {
    isQuickLink: boolean
}

export const SearchBar = ({ isQuickLink }: SearchBarProps) => {
    const arrowUp = useSetAtom(arrowUpAtom)
    const arrowDown = useSetAtom(arrowDownAtom)
    const decExpand = useSetAtom(decExpandAtom)
    const incExpand = useSetAtom(incExpandAtom)
    const resetCollapse = useSetAtom(resetCollapseAtom)
    const setLoading = useSetAtom(isGraphLoadingAtom)

    const handleRefresh = () => setLoading(true)

    const searchPlaceholder = useAtomValue(searchPlaceholderAtom)
    const app = useApp()

    const expandLevel = useAtomValue(getExpandLevel)
    const selectedNode = useAtomValue(selectedNodeAtom)

    const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom)

    const setSearch = (search: string) => {
        setSearchQuery({ query: search })
    }

    const { linkRef, tryOpenUrl } = useUrlOpener()

    const handleCmdEnter = async (event: React.KeyboardEvent<HTMLInputElement>) => {
        const node = selectedNode
        if (node && app) {
            if (event.shiftKey) {
                await highlightLine(app, node.node.location)
            } else {
                await tryOpenUrl(app, node.node)
            }
        }
    };

    const handleKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowUp') {
            arrowUp()
            event.preventDefault();
        } else if (event.key === 'ArrowDown') {
            arrowDown()
            event.preventDefault();
        } else if (event.key === 'Enter') {
            if (isQuickLink) {
                if (!selectedNode) return

                await insertHere(app, reverseMarkdownParsing(selectedNode?.node))
                event.preventDefault();
                const customEvent = new CustomEvent(GraphEvents.RESULT_SELECTED, { detail: { type: "enter" } });
                window.dispatchEvent(customEvent);
                return
            }

            await handleCmdEnter(event);

            // Dispatch custom event
            const customEvent = new CustomEvent(GraphEvents.RESULT_SELECTED, { detail: { type: "enter" } });
            window.dispatchEvent(customEvent);
            event.preventDefault();
        } else if (event.key === 'c' && event.ctrlKey) {
            if (selectedNode) {
                const line = reverseMarkdownParsing(selectedNode.node)
                await navigator.clipboard.writeText(line)
                new Notice('Line copied to clipboard');
            }
            event.preventDefault();
        } else if (event.key === 'i' && event.ctrlKey) {
            if (selectedNode && app) {
                await insertLine(app, selectedNode.node.location)
                const customEvent = new CustomEvent(GraphEvents.RESULT_SELECTED, { detail: { type: "insert" } });
                window.dispatchEvent(customEvent);
                event.preventDefault();
            }
        }
    };

    return <>
        <a style={{ display: "none" }} target="_blank" ref={linkRef} href="#"></a>
    <div className="tw-reset sticky top-0 z-10">

        <div className="relative flex items-center flex-1">
            <div className="flex items-center w-full max-w-4xl mx-auto left-0">
                <input
                    enterKeyHint="search"
                    type="search"
                    spellCheck="false"
                    onChange={ev => setSearch(ev.target.value)}
                    onKeyDown={handleKeyDown}
                    value={searchQuery.query}
                    placeholder={searchPlaceholder}
                    className="w-full pl-5 ml-1 mb-2 mt-2 pr-10 py-3 
                    rounded-lg border focus:border-obs-border hover:border-obs-hover focus:ring-1 
                    outline-none transition-all duration-150"
                />
                
                <button
                    className="relative right-4 text-obs-base-40 focus:outline-none hover:text-obs-accent"
                    aria-label="Clear search"
                    onClick={() => setSearch("")}
                >
                    ×
                </button>
            </div>
            <div className="flex items-center ml-4 gap-1 text-obs-base-40 text-xl">
                <button className="rounded-lg px-3 py-1 hover:text-obs-accent" aria-label="Collapse results" onClick={decExpand}>-</button>
                <button className="rounded-lg px-3 py-1 hover:text-obs-accent" aria-label="Collapse to zero" onClick={resetCollapse}> {expandLevel} </button>
                <button className="rounded-lg px-3 py-1 hover:text-obs-accent" aria-label="Expand results" onClick={incExpand}>+</button>
                <button className="rounded-lg p-2 text-xl text-obs-base-40 hover:text-obs-accent" aria-label="Refresh Tree" onClick={handleRefresh}>
                    <SEARCH_ICON />
                </button>
            </div>
        </div>
        <div className="relative flex flex-1">
            <div className="flex w-full max-w-4xl mx-auto">
                <button 
                    className="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
                    bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700
                    text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700
                    focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600
                    active:bg-gray-50 dark:active:bg-gray-700" 
                    onClick={decExpand}
                >
                    Insert Mode
                </button>
            </div>
        </div>
    </div>
    </>
} 