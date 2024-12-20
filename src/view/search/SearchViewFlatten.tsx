import { SEARCH_ICON } from "src/view/icons";
import { highlightLine, insertLine } from "../../obsidian-utils";
import { GraphEvents } from "../obsidian-views/GraphEvents";
import { useApp } from "../react-context/AppContext";
import { useUrlOpener } from "./useUrlOpener";
import { reverseMarkdownParsing } from "src/copy";
import { Notice } from "obsidian";
import {SearchTreeNode} from "../SearchTreeNode";
import {NodeAttributes} from "../../graph";
import { arrowDownAtom, arrowUpAtom, decExpandAtom, graphAtom, incExpandAtom, isGraphLoadingAtom, resetCollapseAtom, searchQueryAtom, selectedNodeAtom, renderableTreeNodes, incrementPagesAtom, hasMoreTreeNodesAtom, getExpandLevel, searchPlaceholderAtom } from "../react-context/state";
import { getDefaultStore, useAtom, useAtomValue } from "jotai";
import { useSetAtom } from "jotai";

export type TreeNode = {
    attrs: NodeAttributes,
    indent: number,
    hasChildren: boolean
    visible: boolean
    selected: boolean
    index: number
}

export type SearchViewFlattenProps = {
    showSearch?: boolean,
}

export const SearchViewFlatten = ({
                               showSearch = true,
                           }: SearchViewFlattenProps) => {
    
    const treeNodes = useAtomValue(renderableTreeNodes)
    const incrementPages = useSetAtom(incrementPagesAtom)
    const hasMoreTreeNodes = useAtomValue(hasMoreTreeNodesAtom)
    const searchPlaceholder = useAtomValue(searchPlaceholderAtom)
    const [isLoading, setLoading] = useAtom(isGraphLoadingAtom, {store: getDefaultStore()})
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
        setSearchQuery({query: search})
    }

    const {linkRef, tryOpenUrl} = useUrlOpener()

    const handleCmdEnter = async (event: React.KeyboardEvent<HTMLInputElement>) => {
        const node = selectedNode
        if (node && app) {
            if (event.shiftKey) {
                await highlightLine(app, node.attrs.location)
            } else {
                await tryOpenUrl(app, node.attrs)
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
            await handleCmdEnter(event);

            // Dispatch custom event
            const customEvent = new CustomEvent(GraphEvents.RESULT_SELECTED, {detail: {type: "enter"}});
            window.dispatchEvent(customEvent);
            event.preventDefault();
        } else if (event.key === 'c' && event.ctrlKey) {
            if (selectedNode) {
                const line = reverseMarkdownParsing(selectedNode.attrs.tokens)
                await navigator.clipboard.writeText(line)
                new Notice('Line copied to clipboard');
            }
            event.preventDefault();
        } else if (event.key === 'i' && event.ctrlKey) {
            if (selectedNode && app) {
                await insertLine(app, selectedNode.attrs.location)
                const customEvent = new CustomEvent(GraphEvents.RESULT_SELECTED, {detail: {type: "insert"}});
                window.dispatchEvent(customEvent);
                event.preventDefault();
            }
        }
    };

    return <>
        {showSearch &&
            <div>
                <div className="search-row search-view-top">
                    <a style={{display: "none"}} target="_blank" ref={linkRef} href="#"></a>
                    <div className="search-input-container global-search-input-container">
                        <input enterKeyHint="search"
                               type="search"
                               spellCheck="false"
                               onChange={ev => setSearch(ev.target.value)}
                               onKeyDown={handleKeyDown}
                               value={searchQuery.query}
                               placeholder={searchPlaceholder }/>
                        <div className="search-input-clear-button" aria-label="Clear search"
                             onClick={() => setSearch("")}></div>
                    </div>
                    <div className="float-search-view-switch">
                        <div className="clickable-icon" aria-label="Refresh Tree"
                             onClick={handleRefresh}>
                            <SEARCH_ICON/>
                        </div>
                        <div className="clickable-icon" aria-label="Collapse results" onClick={decExpand}> - </div>
                        <div className="clickable-icon" aria-label="Collapse to zero" onClick={resetCollapse}> {expandLevel} </div>
                        <div className="clickable-icon" aria-label="Expand results" onClick={incExpand}> + </div>
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
