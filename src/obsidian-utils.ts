import {App} from "obsidian";
import {Location} from "./graph";

export async function selectLine(app: App, location: Location) {
	const file = app.vault.getFileByPath(location.path);
	if (file) {
		const leaf = app.workspace.getLeaf();
		await leaf.openFile(file);

		// Set timeout to ensure the file is loaded
		setTimeout(() => {
			const editor = (leaf as any).view.sourceMode.cmEditor as CodeMirror.Editor;
			const start = location.position.start;
			editor.setCursor(start.line, 0);
			editor.setSelection(location.position.start, location.position.end);
		}, 100);
	}
}

export async function highlightLine(app: App, loc: Location) {
	const file = app.vault.getFileByPath(loc.path);
	if (file) {
		const leaf = app.workspace.getLeaf();
		await leaf.openFile(file, {active: false});

		setTimeout(() => {
			const editor = (leaf as any).view.sourceMode.cmEditor
			editor.addHighlights([{from: loc.position.start, to: loc.position.end}], "is-flashing", true);
			editor.setSelection(loc.position.start, loc.position.end);
		}, 100);
	}
}

export async function openFileByName(app: App, basename: string) {
	let file = app.vault.getFiles().find(f => f.basename === basename);
	const leaf = app.workspace.getLeaf();
	if (file) {
		await leaf.openFile(file, {active: false});
	} else {
		file = await app.vault.create(basename + ".md", '');
		await leaf.openFile(file, {active: false});
	}
}
