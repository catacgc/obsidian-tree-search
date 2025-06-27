import {App, normalizePath, TFile, FuzzySuggestModal, TFolder, FuzzyMatch} from "obsidian";
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

export async function showFolder(app: App, folderPath: string) {
    const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")?.[0];

    if (fileExplorer) {
        await fileExplorer.view.revealInFolder(app.vault.getFolderByPath(folderPath) || app.vault.getFileByPath(folderPath));
    } else {
        console.error("File explorer is not open.");
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

class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
    private fileToMove: TFile;

    constructor(app: App, fileToMove: TFile) {
        super(app);
        this.fileToMove = fileToMove;
        this.setPlaceholder(`Move ${fileToMove.path} to ...`);
        this.setInstructions([
            { command: "↑↓", purpose: "to navigate" },
            { command: "↵", purpose: "to move file" },
            { command: "esc", purpose: "to dismiss" },
        ]);
    }

    getItems(): TFolder[] {
        const folders: TFolder[] = [];
        const rootFolder = this.app.vault.getRoot();

        // Add root folder
        folders.push(rootFolder);

        // Recursively collect all folders
        const collectFolders = (folder: TFolder) => {
            for (const child of folder.children) {
                if (child instanceof TFolder) {
                    folders.push(child);
                    collectFolders(child);
                }
            }
        };

        collectFolders(rootFolder);
        return folders;
    }

    getItemText(folder: TFolder): string {
        // Return the text that will be used for fuzzy matching
        const folderPath = folder.path || "/";
        const folderName = folder.name || "Vault Root";

        // Include both folder name and path for better fuzzy matching
        return folderPath === "/" ? folderName : `${folderName} ${folderPath}`;
    }

    renderSuggestion(folder: FuzzyMatch<TFolder>, el: HTMLElement) {
        const folderPath = folder.item.path || "/";
        const folderName = folder.item.name || "Vault Root";

        el.createDiv({ text: folderName, cls: "suggestion-title" });
        if (folderPath !== "/") {
            el.createDiv({ text: folderPath, cls: "suggestion-note" });
        }
    }

    async onChooseItem(folder: TFolder) {
        try {
            const targetPath = folder.path || "";
            const newFilePath = normalizePath(
                targetPath ? `${targetPath}/${this.fileToMove.name}` : this.fileToMove.name
            );

            // Check if the file would be moved to the same location
            if (this.fileToMove.path === newFilePath) {
                console.log(`File ${this.fileToMove.name} is already in the selected folder`);
                return;
            }

            // Use FileManager.renameFile which handles moving and updates internal links
            await this.app.fileManager.renameFile(this.fileToMove, newFilePath);
            console.log(`Successfully moved ${this.fileToMove.path} to ${newFilePath}`);
        } catch (error) {
            console.error(`Failed to move file:`, error);
        }
    }
}

export function moveToFolder(app: App, fileSTr: string): void {
    // Get the file to move - either the provided file or the currently active file
    const file = app.vault.getFileByPath(fileSTr)
    const fileToMove = file || app.workspace.getActiveFile();
    if (!fileToMove) {
        console.error("No file to move");
        return;
    }

    // Open the folder selection modal
    new FolderSuggestModal(app, fileToMove).open();
}

export async function revealFolder(app: App, folderPath: string) {
	const folder = app.vault.getFolderByPath(folderPath)

	if (folder) {
        app.showInFolder(folder.path)
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
