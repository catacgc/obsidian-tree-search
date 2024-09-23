import {App} from "obsidian";

export async function openFileAndHighlightLine(app: App, path: string, start: { line: number, col: number }, end: { line: number, col: number }) {
    const file = app.vault.getAbstractFileByPath(path);
    if (file) {
      const leaf = this.app.workspace.getLeaf();
      await leaf.openFile(file);

      // Set timeout to ensure the file is loaded
      setTimeout(() => {
        const editor = this.app.workspace.activeLeaf.view.sourceMode.cmEditor as CodeMirror.Editor;
        editor.setCursor(start.line, 0);
        editor.focus();
        editor.setSelection({ line: start.line, ch: start.col }, { line: end.line, ch: end.col });
      }, 100);
    }
  }

export async function openFileByName(app: App, fileName: string) {
	const file = app.vault.getFiles().find(f => f.name === fileName);
	if (file) {
		const leaf = app.workspace.getLeaf();
		await leaf.openFile(file);
	} else {
		console.error(`File "${fileName}" not found`);
	}
}
