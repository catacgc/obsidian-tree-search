import React from 'react';
import {Platform} from "obsidian";
import {useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {ActionsMolecule} from "../react-context/actions";

/** Truncate text by removing middle characters, keeping start and end visible */
function truncateMiddle(text: string, maxLength: number = 20): string {
    if (text.length <= maxLength) {
        return text;
    }

    const startLength = Math.floor((maxLength - 3) / 2);
    const endLength = maxLength - 3 - startLength;

    return text.substring(0, startLength) + "..." + text.substring(text.length - endLength);
}

export const SearchActions = () => {
    const {executeActionAtom, selectedTreeNodeActionsAtom} = useMolecule(ActionsMolecule)
    const showShortcuts = Platform.isDesktop && false;

    const actions = useAtomValue(selectedTreeNodeActionsAtom)
    const defaultActions = actions.filter(it => it.shortcut)
    const dynamicActions = actions.filter(it => !it.shortcut)
    const execute = useSetAtom(executeActionAtom)

    if (dynamicActions.length > 0) {
        dynamicActions[0].shortcut = { modifiers: [], key: "enter" }
    }

    const allActions = [...dynamicActions, ...defaultActions];

    return <div className="overflow-hidden">
            <div className="bg-transparent p-1 text-obs-base-40 hover:text-obs-accent focus:outline-none hover:cursor-pointer">
                {!actions.length && <div className="italic flex-shrink-0">
                    Select search results to see actions
                </div>}
                {allActions.length > 0 && (
                    <div className="flex items-center overflow-x-auto">
                        {allActions.map((it, index) => {
                            // Calculate adaptive width: distribute available space equally among buttons
                            // Account for separators (1px + 2*4px margin = 9px per separator)
                            const separatorWidth = allActions.length > 1 ? (allActions.length - 1) * 9 : 0;
                            const buttonWidth = `max(80px, calc((100% - ${separatorWidth}px) / ${allActions.length}))`;

                            return (
                                <React.Fragment key={index}>
                                    <button
                                        className="bg-transparent px-3 py-1 text-obs-base-60 hover:text-obs-accent focus:outline-none hover:cursor-pointer flex-shrink-0 min-w-0 whitespace-nowrap"
                                        tabIndex={index}
                                        onClick={() => execute(it)}
                                        title={it.shortcut ? `${it.shortcut.modifiers.length > 0 ? it.shortcut.modifiers.join("+") + "+" : ""}${it.shortcut.key}` : it.title}
                                        style={{ width: buttonWidth }}
                                    >
                                        <span className="block truncate">
                                            {showShortcuts && it.shortcut ?
                                                (it.shortcut.modifiers.length > 0 ? it.shortcut.modifiers.join("+") + "+" : "") + it.shortcut.key :
                                                truncateMiddle(it.title, 40)
                                            }
                                        </span>
                                    </button>
                                    {index < allActions.length - 1 && (
                                        <div className="w-px h-4 bg-obs-base-100 opacity-50 flex-shrink-0 mx-1" />
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </div>
                )}
            </div>
    </div>
}
