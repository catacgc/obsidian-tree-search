// Pasted or dropped files as session attachments (EDITOR.md §3.5), shared by the editors that take them.
import {Notice, type App} from "obsidian";
import {attachmentExt, attachmentKind, attachmentName} from "@mdtree/core";
import {pasteAttachment, type EditorAttachment} from "../../editing/vault-edits";

/** Writes `files` as attachments named after note `base` (attachmentName; a name the vault or `taken` already holds
 *  gets a counter), where Obsidian puts attachments of `sourcePath`. A file that fails shows a Notice and is skipped. */
export async function createAttachments(app: App, files: File[], base: string, sourcePath: string,
                                        taken: readonly EditorAttachment[]): Promise<EditorAttachment[]> {
    const all = [...taken]
    const created: EditorAttachment[] = []
    for (const file of files) {
        const name = attachmentName(base, attachmentKind(file.type), attachmentExt(file.name, file.type), n =>
            !!app.metadataCache.getFirstLinkpathDest(n, "") || all.some(a => a.name.toLowerCase() === n.toLowerCase()))
        try {
            const att = await pasteAttachment(app, file, name, sourcePath)
            all.push(att)
            created.push(att)
        } catch (err) {
            new Notice(err instanceof Error ? err.message : String(err))
        }
    }
    return created
}
