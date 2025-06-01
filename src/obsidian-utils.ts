import {App} from "obsidian";
import {Location} from "./graph";

// Reverse engineer the Canvas api
interface CanvasNode {
    id: string;
    isEditable: () => boolean;
    startEditing: () => void;
}

interface Canvas {
    nodes: Map<string, CanvasNode>;
    selectOnly: (node: CanvasNode) => void;
    zoomToSelection: () => void;
}

interface CanvasView {
    canvas: Canvas;
}


async function highlightCanvasNode(app: App, loc: Location) {
    const file = app.vault.getFileByPath(loc.path);
    if (file) {
        const leaf = app.workspace.getLeaf();
        await leaf.openFile(file, {active: true});

        // Wait for canvas to load and then highlight the node
        setTimeout(() => {
            const view = app.workspace?.getActiveFileView()
            const canvasView = view as unknown as CanvasView;
            if (canvasView && loc.canvasNode) {
                const node = canvasView.canvas.nodes.get(loc.canvasNode);

                if (node) {
                    
                    canvasView.canvas.selectOnly(node);
                    canvasView.canvas.zoomToSelection();

                    if (node.isEditable()) {
                        node.startEditing();

                        setTimeout(() => {
                            const view = app.workspace?.activeEditor?.editor
                            console.log("view", view)
                            if (view) {
                                view.addHighlights([{from: loc.position.start, to: loc.position.end}], "is-flashing", true)
                                view.setSelection(loc.position.start, loc.position.end)
                                view.setCursor(loc.position.start, 0)
                            }
                
                        }, 100);
                    }
                }
            }
        }, 300); // Slightly longer timeout to ensure canvas is loaded
    }
}

export async function highlightLine(app: App, loc: Location) {
    if (loc.path.endsWith(".canvas")) {
        if (loc.canvasNode) {
            await highlightCanvasNode(app, loc)
            return
        }
    }
	const file = app.vault.getFileByPath(loc.path);
	if (file) {
		const leaf = app.workspace.getLeaf();
		await leaf.openFile(file, {active: true});

		setTimeout(() => {
            const view = app.workspace?.activeEditor?.editor
            if (view) {
                view.addHighlights([{from: loc.position.start, to: loc.position.end}], "is-flashing", true)
                view.setSelection(loc.position.start, loc.position.end)
                view.setCursor(loc.position.start, 0)
            }

		}, 100);
	}
}

export async function openFolder(app: App, folderPath: string) {

	const folder = app.vault.getFolderByPath(folderPath)
    console.log(folder)


	if (folder) {
        app.showInFolder(folder.path)
		// await leaf.openFile(folder, {active: false});
	} 
}

export async function openFileByName(app: App, basenameAndAliases: string) {
    const basename = basenameAndAliases.split("|")[0]

	const file = app.metadataCache.getFirstLinkpathDest(basename, basename)
	const leaf = app.workspace.getLeaf();
	if (file) {
		await leaf.openFile(file, {active: false});
	} else {
        await app.workspace.openLinkText(basename, basename)
	}
}

export async function insertHere(app: App, text: string) {

    setTimeout(() => {
        const view = app.workspace?.activeEditor?.editor
        if (view) {
            view.replaceRange(text, view.getCursor())
            view.setCursor({line: view.getCursor().line, ch: view.getCursor().ch + text.length})
        }

    }, 100);
}

export async function insertLine(app: App, loc: Location) {
    const file = app.vault.getFileByPath(loc.path);
    if (file) {
        const leaf = app.workspace.getLeaf();
        await leaf.openFile(file, {active: true});

        setTimeout(() => {
            const view = app.workspace?.activeEditor?.editor
            if (view) {
                view.addHighlights([{from: loc.position.start, to: loc.position.end}], "is-flashing", true)
                view.setCursor(loc.position.end.line, loc.position.end.ch)
                view.newlineAndIndentContinueMarkdownList()
                // view.insertText("\n- ")
            }

        }, 100);
    }
}