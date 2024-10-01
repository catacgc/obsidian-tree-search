import {App, TFile} from "obsidian";

export async function openFileAndHighlightLine(app: App, path: string, start: { line: number, col: number }, end: { line: number, col: number }) {
    const file = app.vault.getFileByPath(path);
    if (file) {
      const leaf = app.workspace.getLeaf();
      await leaf.openFile(file);

      // Set timeout to ensure the file is loaded
      setTimeout(() => {
        const editor = (leaf as any).view.sourceMode.cmEditor as CodeMirror.Editor;
        editor.setCursor(start.line, 0);
        editor.focus();
        editor.setSelection({ line: start.line, ch: start.col }, { line: end.line, ch: end.col });
      }, 100);
    }
  }

export async function openFileByName(app: App, fileName: string) {
	let file = app.vault.getFiles().find(f => f.name === fileName);
	const leaf = app.workspace.getLeaf();
	if (file) {
		await leaf.openFile(file);
	} else {
		file = await app.vault.create(fileName, '');
		await leaf.openFile(file);
	}
}
