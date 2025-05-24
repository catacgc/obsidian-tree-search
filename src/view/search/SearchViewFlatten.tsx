import { SEARCH_ICON } from "../icons";
import { highlightLine, insertHere, insertLine } from "../../obsidian-utils";
import { GraphEvents } from "../obsidian-views/GraphEvents";
import { useApp } from "../react-context/AppContext";
import { useUrlOpener } from "./useUrlOpener";
import { reverseMarkdownParsing } from "../copy";
import { Notice } from "obsidian";
import { SearchTreeNode } from "../SearchTreeNode";
import { ParsedNode } from "../../graph";
import { arrowDownAtom, arrowUpAtom, decExpandAtom, graphAtom, incExpandAtom, isGraphLoadingAtom, resetCollapseAtom, searchQueryAtom, selectedNodeAtom, renderableTreeNodes, incrementPagesAtom, hasMoreTreeNodesAtom, getExpandLevel, searchPlaceholderAtom } from "../react-context/state";
import { getDefaultStore, useAtom, useAtomValue } from "jotai";
import { useSetAtom } from "jotai";

export type TreeNode = {
    node: ParsedNode,
    indent: number,
    hasChildren: boolean
    visible: boolean
    selected: boolean
    index: number
}

export type SearchViewFlattenProps = {
    showSearch?: boolean,
    isQuickLink?: boolean
}

export const SearchViewFlatten = ({
    showSearch = true,
    isQuickLink = false
}: SearchViewFlattenProps) => {

    const treeNodes = useAtomValue(renderableTreeNodes)
    const incrementPages = useSetAtom(incrementPagesAtom)
    const hasMoreTreeNodes = useAtomValue(hasMoreTreeNodesAtom)
    const searchPlaceholder = useAtomValue(searchPlaceholderAtom)
    const [isLoading, setLoading] = useAtom(isGraphLoadingAtom, { store: getDefaultStore() })
    const app = useApp()

    const expandLevel = useAtomValue(getExpandLevel)
    const selectedNode = useAtomValue(selectedNodeAtom)
    const arrowUp = useSetAtom(arrowUpAtom)
    const arrowDown = useSetAtom(arrowDownAtom)
    const decExpand = useSetAtom(decExpandAtom)
    const incExpand = useSetAtom(incExpandAtom)
    const resetCollapse = useSetAtom(resetCollapseAtom)

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

    const handleRefresh = () => setLoading(true)

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

        {showSearch &&
            <div className="w-full tw-reset">

                    <div className="relative flex items-center flex-1">

                    <div className="flex items-center w-full max-w-4xl mx-auto">
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
                            className="relative right-4 text-gray-400 focus:outline-none"
                            aria-label="Clear search"
                            onClick={() => setSearch("")}
                        >
                            ×
                        </button>
                    </div>
                    <div className="flex items-center ml-4 gap-1 text-gray-400 text-xl">
                        <button className="rounded-lg px-3 py-1" aria-label="Collapse results" onClick={decExpand}>-</button>
                        <button className="rounded-lg px-3 py-1" aria-label="Collapse to zero" onClick={resetCollapse}> {expandLevel} </button>
                        <button className="rounded-lg px-3 py-1" aria-label="Expand results" onClick={incExpand}>+</button>
                        <button className="rounded-lg p-2 text-xl text-gray-400" aria-label="Refresh Tree" onClick={handleRefresh}>
                            <SEARCH_ICON />
                        </button>
                    </div>
                </div>
            </div>
        }
        <div className="search-results search-view-middle">
            {isLoading ? (
                <div className="loading-dots">
                    <span>.</span><span>.</span><span>.</span>
                </div>
            ) : (
                <>
                    {treeNodes.map((tree, index) => {
                        return <SearchTreeNode node={tree} key={`${index}`} />
                    })}
                    {hasMoreTreeNodes && <button onClick={incrementPages}>Load More</button>}
                </>

            )}
        </div>
    </>
};



