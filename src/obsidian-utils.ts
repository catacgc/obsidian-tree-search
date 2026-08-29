import {App, normalizePath, TFile, FuzzySuggestModal, TFolder, FuzzyMatch} from "obsidian";
import {Location, PullWrite, PullDeletion} from "@mdtree/core";

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

const INDENT_UNIT = "  "

function leadingWhitespace(line: string): string {
    return line.match(/^\s*/)?.[0] ?? ""
}

function renderPullLines(lines: PullWrite["lines"], baseIndent: string, extraDepth = 0): string[] {
    return lines.map(l => `${baseIndent}${INDENT_UNIT.repeat(l.depth + extraDepth)}- ${l.text}`)
}

// The insertion point for new content merged under an already-existing
// occurrence: right after that line's own existing children (any run of
// immediately-following lines indented deeper than the anchor), so a repeat
// pull appends after what's already there instead of interleaving with it.
function findInsertionPointAfterChildren(lines: string[], anchorLine: number): number {
    const anchorIndent = leadingWhitespace(lines[anchorLine] ?? "").length
    let i = anchorLine + 1
    while (i < lines.length && leadingWhitespace(lines[i]).length > anchorIndent) {
        i++
    }
    return i
}

type PendingOp =
    | { at: number; kind: "insert"; lines: PullWrite["lines"] }
    | { at: number; kind: "delete" }

type ResolvedOp =
    | { at: number; kind: "insert"; lines: string[] }
    | { at: number; kind: "delete" }

/**
 * Applies a "Pull children" plan to the vault: the single cursor-anchored
 * write (if any) is inserted at the active editor's cursor; every
 * existing-anchored write is appended under that occurrence's own children;
 * every deletion removes its now-redundant source line. Per file, insertion
 * points and delete targets are computed against the file's original content
 * before any mutation, then applied in a single descending-line-number pass,
 * so earlier edits never invalidate the line numbers of edits still to come.
 */
export async function applyPullPlan(app: App, writes: PullWrite[], deletions: PullDeletion[]): Promise<void> {
    const cursorWrite = writes.find(w => w.anchor.type === "cursor")
    if (cursorWrite) {
        const text = renderPullLines(cursorWrite.lines, "").join("\n")
        await insertHere(app, text)
    }

    const opsByFile = new Map<string, PendingOp[]>()

    for (const write of writes) {
        if (write.anchor.type !== "existing") continue
        const { path, position } = write.anchor.location
        if (!opsByFile.has(path)) opsByFile.set(path, [])
        opsByFile.get(path)!.push({ at: position.start.line, kind: "insert", lines: write.lines })
    }

    for (const deletion of deletions) {
        const { path, position } = deletion.location
        if (!opsByFile.has(path)) opsByFile.set(path, [])
        opsByFile.get(path)!.push({ at: position.start.line, kind: "delete" })
    }

    for (const [path, ops] of opsByFile) {
        const file = app.vault.getFileByPath(path)
        if (!file) continue

        const content = await app.vault.read(file)
        const lines = content.split("\n")

        // Resolve each "insert" op's actual splice target and rendered text
        // against the pristine, pre-mutation content before anything moves.
        const resolved: ResolvedOp[] = ops.map(op => {
            if (op.kind === "delete") return op
            const anchorIndent = leadingWhitespace(lines[op.at] ?? "")
            const insertAt = findInsertionPointAfterChildren(lines, op.at)
            return { at: insertAt, kind: "insert" as const, lines: renderPullLines(op.lines, anchorIndent, 1) }
        })

        // Ties (an insert and a delete resolving to the same index) process the
        // delete first, so the insert lands where the deleted line used to be
        // rather than displacing it.
        resolved.sort((a, b) => b.at - a.at || (a.kind === "delete" ? -1 : 1))

        for (const op of resolved) {
            if (op.kind === "delete") {
                lines.splice(op.at, 1)
            } else {
                lines.splice(op.at, 0, ...op.lines)
            }
        }

        await app.vault.modify(file, lines.join("\n"))
    }
}
