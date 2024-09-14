import { App } from "obsidian";

export async function openFileAndHighlightLine(app: App, path: string, lineNumber: number) {
    const file = app.vault.getAbstractFileByPath(path);
    if (file) {
      const leaf = this.app.workspace.getLeaf();
      await leaf.openFile(file);

      // Set timeout to ensure the file is loaded
      setTimeout(() => {
        const editor = this.app.workspace.activeLeaf.view.sourceMode.cmEditor as CodeMirror.Editor;
        editor.setCursor(lineNumber, 0);
        editor.focus();
        editor.setSelection({ line: lineNumber, ch: 0 }, { line: lineNumber, ch: 40 });
      }, 100);
    }
  }