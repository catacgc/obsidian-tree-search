import {App} from "obsidian";
import {Location} from "./graph";

export async function highlightLine(app: App, loc: Location) {
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