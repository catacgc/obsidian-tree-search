import { useAtomValue, useSetAtom } from "jotai";
import { ParsedNode } from "../../graph";
import { hasMoreTreeNodesAtom, incrementPagesAtom, isGraphLoadingAtom, renderableTreeNodes } from "../react-context/state";
import { SearchTreeNode } from "../SearchTreeNode";
import { SearchBar } from "./SearchBar";

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
    const isLoading = useAtomValue(isGraphLoadingAtom)

    return <>
        {showSearch &&
            <SearchBar isQuickLink={isQuickLink}/>
        }
        <div className="flex-1 overflow-y-auto">
            {isLoading ? (
                <LoadingDots />
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

const LoadingDots = () => {
    return <div className="flex justify-center items-center space-x-1 text-6xl font-bold text-gray-600 dark:text-gray-300">
        <span className="animate-bounce [animation-delay:-0.3s]">.</span>
        <span className="animate-bounce [animation-delay:-0.15s]">.</span>
        <span className="animate-bounce">.</span>
    </div>
}