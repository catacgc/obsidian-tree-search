// Obsidian-side appliers for editor mode (EDITOR.md). Every editor-mode vault
// write goes through here; the content transforms themselves are pure and live
// in @mdtree/core (edit/outline-edit.ts, edit/attachments.ts). Each applier
// returns the markdown files it touched so the caller can reindex them.
import type {App, TFile} from "obsidian"
import {moment, normalizePath} from "obsidian"
import {
    appendContent,
    appendOutline,
    cutSubtree,
    pasteAtOutlineEnd,
    pasteUnderLinkBullet,
    replaceLineText,
    splitLines,
    StaleLineError,
    type AttachmentPlan,
    type OutlineLine,
    type SessionAttachment,
} from "@mdtree/core"
import type {DailyNoteConfig} from "../indexing/indexed-tree"

export type EditorAttachment = SessionAttachment & { path: string }

export type ReparentPlan =
    | { kind: "frontmatter"; childPath: string; oldName: string; newName: string; relation: string }
    | { kind: "cross-file"; sourcePath: string; line: number; head: string; newName: string }
    | { kind: "same-file"; sourcePath: string; line: number; head: string; newName: string }

type MomentLike = { format(format: string): string }
// Obsidian's `moment` re-export isn't typed as directly callable.
const nowMoment = (): MomentLike => (moment as unknown as () => MomentLike)()

const parentDir = (path: string): string => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""

export function dailyNotePath(cfg: DailyNoteConfig, now: MomentLike = nowMoment()): string {
    return normalizePath(`${cfg.folder ? cfg.folder + "/" : ""}${now.format(cfg.format)}.md`)
}

export function newNotePath(app: App, name: string, sourcePath: string): string {
    const parent = app.fileManager.getNewFileParent(sourcePath)
    return normalizePath(parent.path === "/" ? `${name}.md` : `${parent.path}/${name}.md`)
}

export async function getOrCreateDailyNote(app: App, cfg: DailyNoteConfig, now: MomentLike = nowMoment()): Promise<TFile> {
    const path = dailyNotePath(cfg, now)
    const existing = app.vault.getFileByPath(path)
    if (existing) return existing

    const folder = parentDir(path)
    if (folder && !app.vault.getFolderByPath(folder)) await app.vault.createFolder(folder)

    let content = ""
    const template = cfg.template ? app.metadataCache.getFirstLinkpathDest(cfg.template, "") : null
    if (template) {
        const date = now.format(cfg.format)
        content = (await app.vault.read(template))
            .replace(/\{\{(date|title)\}\}/g, date)
            .replace(/\{\{time\}\}/g, now.format("HH:mm"))
    }
    return app.vault.create(path, content)
}

export async function pasteAttachment(app: App, file: File, name: string, sourcePath: string): Promise<EditorAttachment> {
    const path = await app.fileManager.getAvailablePathForAttachment(name, sourcePath)
    const created = await app.vault.createBinary(path, await file.arrayBuffer())
    // Obsidian may adjust the name; the created file's name is authoritative.
    const dot = created.name.lastIndexOf(".")
    return {name: created.name, ext: dot > 0 ? created.name.slice(dot + 1).toLowerCase() : "", path: created.path}
}

/** Renames and trashes session attachments per `plan`; returns the survivors with their new names/paths. */
export async function applyAttachmentPlan(app: App, attachments: EditorAttachment[], plan: AttachmentPlan): Promise<EditorAttachment[]> {
    const survivors: EditorAttachment[] = []
    for (const att of attachments) {
        const file = app.vault.getFileByPath(att.path)
        if (plan.trash.includes(att.name)) {
            if (file) await app.fileManager.trashFile(file)
            continue
        }
        const rename = plan.renames.find(r => r.from === att.name)
        if (rename && file) {
            const dir = parentDir(att.path)
            const path = dir ? `${dir}/${rename.to}` : rename.to
            await app.fileManager.renameFile(file, path)
            survivors.push({...att, name: rename.to, path})
        } else {
            survivors.push(att)
        }
    }
    return survivors
}

export async function trashSessionAttachments(app: App, attachments: EditorAttachment[]): Promise<void> {
    for (const att of attachments) {
        const file = app.vault.getFileByPath(att.path)
        if (!file) continue
        try {
            await app.fileManager.trashFile(file)
        } catch (err) {
            console.warn(`[tree-search] Failed to trash ${att.path}:`, err)
        }
    }
}

/** Appends `text` to note `name`, or creates it next to new notes for `newNoteSourcePath`. */
export async function writeNoteContents(app: App, name: string, text: string, newNoteSourcePath: string): Promise<TFile> {
    const existing = app.metadataCache.getFirstLinkpathDest(name, "")
    if (existing) {
        await app.vault.process(existing, c => appendContent(c, text))
        return existing
    }
    const path = newNotePath(app, name, newNoteSourcePath)
    if (app.vault.getAbstractFileByPath(path)) throw new Error(`Note "${name}" already exists`)
    return app.vault.create(path, text.endsWith("\n") ? text : text + "\n")
}

export async function appendToDailyNote(app: App, outline: OutlineLine[], cfg: DailyNoteConfig, now: MomentLike = nowMoment()): Promise<TFile[]> {
    const daily = await getOrCreateDailyNote(app, cfg, now)
    await app.vault.process(daily, c => appendOutline(c, outline))
    return [daily]
}

export async function editLine(app: App, path: string, line: number, expectedLine: string, newLine: string): Promise<TFile[]> {
    const file = app.vault.getFileByPath(path)
    if (!file) throw new StaleLineError()
    await app.vault.process(file, c => replaceLineText(c, line, expectedLine, newLine))
    return [file]
}

const linkName = (entry: string): string => (entry.match(/\[\[([^\]|#]+)/)?.[1] ?? entry).trim()

export async function reparent(app: App, plan: ReparentPlan): Promise<TFile[]> {
    if (plan.kind === "frontmatter") {
        const child = app.vault.getFileByPath(plan.childPath)
        if (!child) throw new StaleLineError()
        await app.fileManager.processFrontMatter(child, fm => {
            const raw = fm[plan.relation]
            const entries: string[] = Array.isArray(raw) ? raw.map(String) : raw == null ? [] : [String(raw)]
            const i = entries.findIndex(e => linkName(e).toLowerCase() === plan.oldName.toLowerCase())
            if (i < 0) throw new StaleLineError()
            entries[i] = `[[${plan.newName}]]`
            fm[plan.relation] = Array.isArray(raw) ? entries : entries[0]
        })
        return [child]
    }

    const source = app.vault.getFileByPath(plan.sourcePath)
    if (!source) throw new StaleLineError()

    if (plan.kind === "same-file") {
        await app.vault.process(source, c => {
            const cut = cutSubtree(c, plan.line, plan.head)
            return pasteUnderLinkBullet(cut.content, plan.newName, cut.block)
        })
        return [source]
    }

    // Cross-file: copy to the destination first, then cut, so nothing is lost if the cut guard fails.
    const {block} = cutSubtree(await app.vault.read(source), plan.line, plan.head)
    const dest = app.metadataCache.getFirstLinkpathDest(plan.newName, "")
        ?? await app.vault.create(newNotePath(app, plan.newName, plan.sourcePath), "")
    await app.vault.process(dest, c => pasteAtOutlineEnd(c, block))
    try {
        await app.vault.process(source, c => cutSubtree(c, plan.line, plan.head).content)
    } catch {
        throw new Error(`Copied to [[${plan.newName}]] but the original line changed — remove it manually`)
    }
    return [dest, source]
}

export async function readLine(app: App, path: string, line: number): Promise<string | null> {
    const file = app.vault.getFileByPath(path)
    if (!file) return null
    return splitLines(await app.vault.read(file)).lines[line] ?? null
}
