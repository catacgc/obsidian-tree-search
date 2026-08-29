import {App, normalizePath, TFile, FuzzySuggestModal, TFolder, FuzzyMatch} from "obsidian";
import {Location, PullDeletion, upsertOrganiseSections, type NotesGraph, type OrganiseHome, type SectionWrite} from "@mdtree/core";

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

export async function archiveLine(app: App, loc: Location) {
    const file = app.vault.getFileByPath(loc.path)
    if (!file) return

    const content = await app.vault.read(file)
    const lines = content.split("\n")
    const lineIdx = loc.position.start.line

    if (lineIdx >= lines.length) return

    // Append the archive annotation before any trailing whitespace
    lines[lineIdx] = lines[lineIdx].trimEnd() + " (meta-mdtree:: archive)"
    await app.vault.modify(file, lines.join("\n"))
}

export async function unarchiveLine(app: App, loc: Location) {
    const file = app.vault.getFileByPath(loc.path)
    if (!file) return

    const content = await app.vault.read(file)
    const lines = content.split("\n")
    const lineIdx = loc.position.start.line

    if (lineIdx >= lines.length) return

    // Remove the archive annotation and trim trailing whitespace
    lines[lineIdx] = lines[lineIdx].replace(/\s*\(meta-mdtree::\s*archive\)/, "").trimEnd()
    await app.vault.modify(file, lines.join("\n"))
}

// `fm.tags` may be a bare string (Obsidian's YAML shorthand for a single tag)
// rather than an array; normalize before mutating.
function normalizeTags(tags: unknown): string[] {
    if (Array.isArray(tags)) return tags
    if (typeof tags === "string") return [tags]
    return []
}

export async function archivePage(app: App, path: string, archiveTag: string) {
    const file = app.vault.getFileByPath(path)
    if (!file) return

    await app.fileManager.processFrontMatter(file, (fm) => {
        const tags = normalizeTags(fm.tags)
        if (!tags.includes(archiveTag)) tags.push(archiveTag)
        fm.tags = tags
    })
}

export async function unarchivePage(app: App, path: string, archiveTag: string) {
    const file = app.vault.getFileByPath(path)
    if (!file) return

    await app.fileManager.processFrontMatter(file, (fm) => {
        fm.tags = normalizeTags(fm.tags).filter((t) => t !== archiveTag)
    })
}

// ── Pull children ─────────────────────────────────────────────────────────────

/**
 * A topic's home note: its own real file if it has one, otherwise a
 * same-folder-as-the-organising-note candidate path (which may or may not
 * exist yet - `exists` tells the caller whether to create it). `pageKey`
 * must name a "page" node; callers only ever call this for page-type
 * children of the pull tree.
 */
export function resolveHome(app: App, graph: NotesGraph, pageKey: string, organisingNotePath: string): OrganiseHome {
    const node = graph.getNodeAttributes(pageKey)
    if (node.nodeType !== "page") throw new Error(`resolveHome called with a non-page key: ${pageKey}`)
    if (!node.isReference) return { path: node.location.path, exists: true }

    const slash = organisingNotePath.lastIndexOf("/")
    const folder = slash === -1 ? "" : organisingNotePath.slice(0, slash)
    const candidatePath = folder ? `${folder}/${node.page}.md` : `${node.page}.md`
    return { path: candidatePath, exists: app.vault.getFileByPath(candidatePath) != null }
}

/**
 * Applies an organise plan to the vault: for each `SectionWrite`, creates
 * its home file first if it doesn't exist yet, then upserts its two managed
 * sections (see `upsertOrganiseSections`); then applies every deletion.
 * Per file, deletions are applied first, against the file's original
 * content and in descending line-number order, so multiple deletions in the
 * same file never invalidate each other's line numbers - and so that a
 * subsequent section upsert (which is marker/text based, not line-number
 * based) is never thrown off by lines the deletions already removed above
 * it. A file that receives both a section write and deletions is only read
 * and written once.
 */
export async function applyOrganisePlan(app: App, writes: SectionWrite[], deletions: PullDeletion[]): Promise<void> {
    const deletionsByPath = new Map<string, PullDeletion[]>()
    for (const deletion of deletions) {
        if (!deletionsByPath.has(deletion.location.path)) deletionsByPath.set(deletion.location.path, [])
        deletionsByPath.get(deletion.location.path)!.push(deletion)
    }

    const writesByPath = new Map<string, SectionWrite>()
    for (const write of writes) {
        if (write.children.length === 0 && write.mentions.length === 0) continue
        writesByPath.set(write.home.path, write)
    }

    const touchedPaths = new Set<string>([...deletionsByPath.keys(), ...writesByPath.keys()])

    for (const path of touchedPaths) {
        const write = writesByPath.get(path)

        let file = app.vault.getFileByPath(path)
        if (!file && write && !write.home.exists) {
            file = await app.vault.create(path, "")
        }
        if (!file) continue

        const lines = (await app.vault.read(file)).split("\n")

        const dels = deletionsByPath.get(path)
        if (dels) {
            const sorted = [...dels].sort((a, b) => b.location.position.start.line - a.location.position.start.line)
            for (const deletion of sorted) lines.splice(deletion.location.position.start.line, 1)
        }

        let content = lines.join("\n")
        if (write) {
            content = upsertOrganiseSections(
                content,
                write.children.map(l => `- ${l.text}`),
                write.mentions.map(l => `- ${l.text}`),
            )
        }

        await app.vault.modify(file, content)
    }
}
