export const Instructions = () => {
    return <div className="tree-search-modal-instructions">
        <div className="tree-search-modal-instructions-navigate"><span
            className="tree-search-modal-instructions-key">↑↓</span><span
            className="tree-search-modal-instructions-text">Navigate</span></div>

        <div className="tree-search-modal-instructions-enter"><span
            className="tree-search-modal-instructions-key">↵</span><span
            className="tree-search-modal-instructions-text">Open Url or Note</span></div>

        <div className="tree-search-modal-instructions-enter"><span
            className="tree-search-modal-instructions-key">Shift+↵</span><span
            className="tree-search-modal-instructions-text">Highlight Source</span></div>

        {/*<div className="tree-search-modal-instructions-enter"><span*/}
        {/*    className="tree-search-modal-instructions-key">Cmd/Ctrl+↵</span><span*/}
        {/*    className="tree-search-modal-instructions-text">Select</span></div>*/}

    </div>
}
