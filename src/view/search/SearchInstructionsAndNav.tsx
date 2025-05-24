import React from 'react';
import { useSetAtom } from "jotai";
import { Platform } from "obsidian";
import { ArrowDown, ArrowUp, Copy, ListEnd } from "lucide-react";
import { arrowDownAtom, arrowUpAtom } from "../react-context/state";

export const SearchInstructionsAndNav = () => {
    const isDesktop = Platform.isDesktop;
    const isMobile = Platform.isMobile;
    const arrowDown = useSetAtom(arrowDownAtom)
    const arrowUp = useSetAtom(arrowUpAtom)

    return <div>
        {/* <div className="search-container-modal-instructions tree-search-modal-instructions">
            <div className="mobile-toolbar">
                <div className="mobile-toolbar-options-container">
                    <div className="mobile-toolbar-options-list">
                        <div className="mobile-toolbar-option">
                            <div className="mobile-toolbar-options-item">
                                <button onClick={() => arrowDown()}>
                                    <ArrowDown />
                                </button>
                            </div>
                            <div className="mobile-toolbar-options-item">
                                <button onClick={() => arrowUp()}>
                                    <ArrowUp />
                                </button>
                            </div>
                            <div className="mobile-toolbar-options-item">
                                <button>
                                    <Copy /> Copy
                                </button>
                            </div>
                            <div className="mobile-toolbar-options-item">
                                <button>
                                    <ListEnd /> Insert
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div> */}

        {isDesktop && <div className="tw-reset flex gap-2 text-xs border-t 
        border-obs-base-20 p-2 justify-center flex-wrap">
            <div className="flex items-center gap-1 whitespace-nowrap"><span
                className="text-obs-base-100 font-bold">↑↓</span><span
                    className="text-obs-base-60">Navigate</span></div>

            <div className="flex items-center gap-1 whitespace-nowrap"><span
                className="text-obs-base-100 font-bold">↵</span><span
                    className="text-obs-base-60">Open Url or Note</span></div>

            <div className="flex items-center gap-1 whitespace-nowrap"><span
                className="text-obs-base-100 font-bold">Shift+↵</span><span
                    className="text-obs-base-60">Highlight Source</span></div>

            <div className="flex items-center gap-1 whitespace-nowrap"><span
                className="text-obs-base-100 font-bold">Ctrl+C</span><span
                    className="text-obs-base-60">Copy to Clipboard</span></div>

            <div className="flex items-center gap-1 whitespace-nowrap"><span
                className="text-obs-base-100 font-bold">Ctrl+I</span><span
                    className="text-obs-base-60">Insert After</span></div>
        </div>}
    </div>
}