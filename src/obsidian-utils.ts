import {App, normalizePath, TFile, FuzzySuggestModal, TFolder, FuzzyMatch} from "obsidian";
import {Location, PullDeletion, addArchiveTag, convertLegacyArchive, removeArchiveTag, renderPullLine, upsertOrganiseSections, HEADER_RE, type NotesGraph, type OrganiseHome, type SectionWrite, type PullLine, type PullNode} from "@mdtree/core"

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

/** Rewrites a source line, or (when `headerAware`) the line below a heading, keeping CRLF endings. */
async function editLine(app: App, loc: Location, edit: (line: string) => string, headerAware = false) {
    const file = app.vault.getFileByPath(loc.path)
    if (!file) return

    const content = await app.vault.read(file)
    const lines = content.split("\n")
    const sourceLine = loc.position.start.line
    const lineIdx = sourceLine + (headerAware && HEADER_RE.test(lines[sourceLine] ?? "") ? 1 : 0)

    if (lineIdx >= lines.length) return

    const cr = lines[lineIdx].endsWith("\r") ? "\r" : ""
    lines[lineIdx] = edit(lines[lineIdx].slice(0, lines[lineIdx].length - cr.length)) + cr
    await app.vault.modify(file, lines.join("\n"))
}

/** Appends `#<archiveTag>` to a line, or the line immediately below a heading. */
export async function archiveLine(app: App, loc: Location, archiveTag: string) {
    await editLine(app, loc, line => addArchiveTag(line, archiveTag), true)
}

export async function unarchiveLine(app: App, loc: Location, archiveTag: string) {
    await editLine(app, loc, line => removeArchiveTag(line, archiveTag), true)
}

/** Rewrites every legacy `(meta-mdtree:: archive)` marker in the vault's notes to `#<archiveTag>`. Returns the notes
 *  changed and how many lines; the caller reindexes them. */
export async function convertLegacyArchiveMarkers(app: App, archiveTag: string): Promise<{files: TFile[], lines: number}> {
    const files: TFile[] = []
    let lines = 0
    for (const file of app.vault.getMarkdownFiles()) {
        if (!(await app.vault.cachedRead(file)).includes("meta-mdtree::")) continue
        let changed = 0
        await app.vault.process(file, content => {
            const converted = convertLegacyArchive(content, archiveTag)
            changed = converted.lines
            return converted.content
        })
        if (changed === 0) continue
        files.push(file)
        lines += changed
    }
    return {files, lines}
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

function leadingWhitespaceLength(line: string): number {
    return line.match(/^\s*/)?.[0].length ?? 0
}

/**
 * Reads `node`'s source file and returns any line nested directly or
 * transitively under it that the indexer skipped entirely - plain text with
 * no wikilink, tag, or URL (`shouldSkip` in the core indexer never turns
 * these into graph nodes at all, so `buildPullTree` can't see them; this is
 * the only way they can reach an organise write). A line that IS already
 * one of `node`'s own `PullNode` children is left alone here - it (and
 * everything nested under it) is handled by that child's own call to this
 * same function, not duplicated from the parent's scan.
 *
 * Depths in the returned lines are *relative to `node` itself* (the first
 * unindexed line one level deeper than `node`'s own line comes back as
 * `depth: 1`, a line nested one level deeper than that as `depth: 2`, and so
 * on), not the final depth in the eventual write. This function is async
 * (it reads the vault) while `planOrganiseWrites` and the `extraLinesOf`
 * callback it takes are synchronous, so it can't be called from inside that
 * walk - callers instead call this once per node ahead of time (e.g. while
 * building the preview), then add each node's *actual* depth (the value
 * `planOrganiseWrites` would pass into `extraLinesOf`) on top of these
 * relative depths before handing them to `planOrganiseWrites`.
 */
export async function collectUnindexedChildLines(app: App, node: PullNode): Promise<PullLine[]> {
    const file = app.vault.getFileByPath(node.node.location.path)
    if (!file) return []

    const lines = (await app.vault.read(file)).split("\n")
    const headLine = node.node.location.position.start.line
    const headIndent = leadingWhitespaceLength(lines[headLine] ?? "")
    const directChildLines = new Set(node.children.map(c => c.node.location.position.start.line))

    const result: PullLine[] = []
    const indentStack: { indent: number; depth: number }[] = [{ indent: headIndent, depth: 0 }]

    let i = headLine + 1
    while (i < lines.length) {
        const line = lines[i]
        if (line.trim().length === 0) { i++; continue }

        const indent = leadingWhitespaceLength(line)
        if (indent <= headIndent) break

        if (directChildLines.has(i)) {
            // Already a real PullNode - skip its whole nested span (blank
            // lines included) rather than re-emitting it or its own
            // unindexed descendants; that child handles its own scan.
            i++
            while (i < lines.length && (lines[i].trim().length === 0 || leadingWhitespaceLength(lines[i]) > indent)) i++
            continue
        }

        while (indentStack.length > 1 && indent <= indentStack[indentStack.length - 1].indent) indentStack.pop()
        if (indent > indentStack[indentStack.length - 1].indent) {
            indentStack.push({ indent, depth: indentStack[indentStack.length - 1].depth + 1 })
        }

        const text = line.trim().replace(/^[-*+]\s+/, "")
        result.push({ depth: indentStack[indentStack.length - 1].depth, text })
        i++
    }

    return result
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
                write.children.map(renderPullLine),
                write.mentions.map(renderPullLine),
            )
        }

        await app.vault.modify(file, content)
    }
}
