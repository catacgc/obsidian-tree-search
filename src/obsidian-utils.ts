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
