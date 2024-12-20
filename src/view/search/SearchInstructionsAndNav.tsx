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

        {isDesktop && <div className="search-container-modal-instructions tree-search-modal-instructions">
            <div className="tree-search-modal-instructions-navigate"><span
                className="tree-search-modal-instructions-key">↑↓</span><span
                    className="tree-search-modal-instructions-text">Navigate</span></div>

            <div className="tree-search-modal-instructions-enter"><span
                className="tree-search-modal-instructions-key">↵</span><span
                    className="tree-search-modal-instructions-text">Open Url or Note</span></div>

            <div className="tree-search-modal-instructions-enter"><span
                className="tree-search-modal-instructions-key">Shift+↵</span><span
                    className="tree-search-modal-instructions-text">Highlight Source</span></div>

            <div className="tree-search-modal-instructions-enter"><span
                className="tree-search-modal-instructions-key">Ctrl+C</span><span
                    className="tree-search-modal-instructions-text">Copy to Clipboard</span></div>

            <div className="tree-search-modal-instructions-enter"><span
                className="tree-search-modal-instructions-key">Ctrl+I</span><span
                    className="tree-search-modal-instructions-text">Insert After</span></div>
        </div>}
    </div>
}