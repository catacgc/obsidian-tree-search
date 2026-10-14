// Obsidian-side appliers for editor mode (EDITOR.md). Every editor-mode vault
// write goes through here; the content transforms themselves are pure and live
// in @mdtree/core (edit/outline-edit.ts, edit/attachments.ts). Each applier
// returns the markdown files it touched so the caller can reindex them, except
// `appendToDailyNote`, which returns its one file and the line it appended at.
import type {App, TFile} from "obsidian"
import {moment, normalizePath} from "obsidian"
import {
    appendContent,
    applyTaskEdit,
    appendOutline,
    ensureHeading,
    firstAppendedLine,
    cutSubtree,
    cutHeadingSection,
    lineHasIdentity,
    localIsoDate,
    NOTE_BODY_CHANGED,
    pasteAtOutlineEnd,
    pasteUnderLine,
    pasteUnderLinkBullet,
    replaceNoteBody,
    replaceLineText,
    rescheduleDate,
    splitLines,
    StaleLineError,
    stampMovedBlock,
    type AttachmentPlan,
    type NotePatch,
    type OutlineLine,
    type RescheduleKind,
    type SessionAttachment,
    type TextNode,
    type TaskLineEdit,
} from "@mdtree/core"
import type {DailyNoteConfig} from "../indexing/indexed-tree"

export type EditorAttachment = SessionAttachment & { path: string }

/** The plans drag-to-reparent produces (`classifyReparent`). */
export type DragReparentPlan =
    | { kind: "frontmatter"; childPath: string; oldName: string; newName: string; relation: string }
    /** A line's subtree moves to the end of `[[newName]]`'s outline. `stampDate`: the source note's date, added as
     *  `[created::]` to the block's undated indexed lines (stampMovedBlock); null leaves them as they are. */
    | { kind: "cross-file"; sourcePath: string; line: number; head: string; newName: string; stampDate: string | null }
    | { kind: "same-file"; sourcePath: string; line: number; head: string; newName: string }

export type ReparentPlan =
    | DragReparentPlan
    /** A page's frontmatter parent becomes `[[newName]]`; `childPath: null` is a reference page, whose note is created first. */
    | { kind: "set-parent"; childPath: string | null; childName: string; relation: string; newName: string; oldName: string | null; cfg: DailyNoteConfig }
    | { kind: "to-folder"; childPath: string; folderPath: string }
    /** A line's subtree moves under `- [[parentLink]]` in today's daily note. `stampDate`: the source note's date, added
     *  as `[created::]` to the block's undated indexed lines (stampMovedBlock); null leaves them as they are. */
    | { kind: "to-daily"; sourcePath: string; line: number; head: string; parentLink: string; cfg: DailyNoteConfig; stampDate: string | null }
    /** A line's subtree moves under another line, as its last children. `stampDate`: the source note's date, added as
     *  `[created::]` to the block's undated indexed lines (stampMovedBlock); null leaves them as they are. */
    | { kind: "under-line"; sourcePath: string; line: number; head: string; targetPath: string; targetLine: number; targetHead: string; stampDate: string | null }

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

/** Note `name` (link resolution), or a new empty note next to new notes for `sourcePath`. */
export async function noteFileFor(app: App, name: string, sourcePath: string): Promise<TFile> {
    return app.metadataCache.getFirstLinkpathDest(name, "") ?? await app.vault.create(newNotePath(app, name, sourcePath), "")
}

/** Adds `value` to frontmatter `key` without overwriting: a missing/empty key gets it (as a one-item list when `list`),
 *  a different scalar becomes a two-item list, a list gains it; an equal value (trimmed, case-insensitive) is a no-op. */
export function addFrontmatterValue(fm: Record<string, unknown>, key: string, value: string, list: boolean): void {
    const raw = fm[key]
    const same = (e: unknown) => String(e).trim().toLowerCase() === value.trim().toLowerCase()
    if (raw == null || raw === "") fm[key] = list ? [value] : value
    else if (Array.isArray(raw)) {
        if (!raw.some(same)) raw.push(value)
    } else if (!same(raw)) fm[key] = [String(raw), value]
}

/** Applies one link-bullet patch (`planOutlinePatches`): creates the note when missing (today's daily note through its
 *  template), appends missing headings, and adds aliases/fields to its frontmatter. Idempotent. */
export async function applyNotePatch(app: App, patch: NotePatch, cfg: DailyNoteConfig, now: MomentLike = nowMoment()): Promise<TFile> {
    const daily = dailyNotePath(cfg, now)
    const dailyName = daily.split("/").pop()!.replace(/\.md$/, "")
    const file = patch.name.toLowerCase() === dailyName.toLowerCase()
        ? await getOrCreateDailyNote(app, cfg, now)
        : await noteFileFor(app, patch.name, daily)
    if (patch.headings.length > 0) await app.vault.process(file, c => patch.headings.reduce(ensureHeading, c))
    if (patch.aliases.length > 0 || patch.fields.length > 0) {
        await app.fileManager.processFrontMatter(file, fm => {
            for (const a of patch.aliases) addFrontmatterValue(fm, "aliases", a, true)
            for (const f of patch.fields) addFrontmatterValue(fm, f.key, f.value, false)
        })
    }
    return file
}

/** Renames the file at `path` to `stem` plus its extension, in its own folder; Obsidian's renameFile updates the links to
 *  it. Returns the new path; throws StaleLineError if the file is gone. */
export async function renameVaultFile(app: App, path: string, stem: string): Promise<string> {
    const file = app.vault.getFileByPath(path)
    if (!file) throw new StaleLineError()
    const name = file.extension ? `${stem.trim()}.${file.extension}` : stem.trim()
    const dir = parentDir(path)
    const dest = dir ? `${dir}/${name}` : name
    if (dest === path) return path
    if (app.vault.getAbstractFileByPath(dest)) throw new Error(`"${name}" already exists`)
    await app.fileManager.renameFile(file, dest)
    return dest
}

/** Inserts `block` as the last children of line `line` of `path`; throws StaleLineError if the file is gone or the line changed. */
export async function appendUnderLine(app: App, path: string, line: number, expectedHead: string, block: string[]): Promise<{ file: TFile; line: number }> {
    const file = app.vault.getFileByPath(path)
    if (!file) throw new StaleLineError()
    let inserted = 0
    await app.vault.process(file, c => {
        const out = pasteUnderLine(c, line, expectedHead, block)
        inserted = out.line
        return out.content
    })
    return {file, line: inserted}
}

/** Replaces the whole note at `path` with `text`, or creates it when `original` is null; throws when the file changed (or appeared) since `original` was read. */
export async function writeWholeNote(app: App, path: string, original: string | null, text: string): Promise<TFile> {
    const changed = () => new Error("Note changed since editing started — reopen the editor")
    const existing = app.vault.getFileByPath(path)
    if (original === null) {
        if (existing) throw changed()
        const folder = parentDir(path)
        if (folder && !app.vault.getFolderByPath(folder)) await app.vault.createFolder(folder)
        return app.vault.create(path, text)
    }
    if (!existing) throw changed()
    await app.vault.process(existing, c => {
        if (c !== original) throw changed()
        return text
    })
    return existing
}

/** Replaces what follows note `path`'s leading outline with `body` (replaceNoteBody); throws NOTE_BODY_CHANGED when
 *  that part is no longer `original` or the file is gone. */
export async function writeNoteBody(app: App, path: string, original: string, body: string): Promise<TFile> {
    const file = app.vault.getFileByPath(path)
    if (!file) throw new Error(NOTE_BODY_CHANGED)
    await app.vault.process(file, c => replaceNoteBody(c, original, body))
    return file
}

export async function appendToDailyNote(app: App, outline: OutlineLine[], cfg: DailyNoteConfig, now: MomentLike = nowMoment()): Promise<{ file: TFile; line: number | null }> {
    const daily = await getOrCreateDailyNote(app, cfg, now)
    let line: number | null = null
    await app.vault.process(daily, c => {
        const out = appendOutline(c, outline)
        line = firstAppendedLine(c, out)
        return out
    })
    return {file: daily, line}
}

export async function editLine(app: App, path: string, line: number, expectedLine: string, newLine: string): Promise<TFile[]> {
    const file = app.vault.getFileByPath(path)
    if (!file) throw new StaleLineError()
    await app.vault.process(file, c => replaceLineText(c, line, expectedLine, newLine))
    return [file]
}

/** Deletes list line `line` of `path` with every line nested under it; throws StaleLineError if the file is gone or the line changed. */
export async function deleteSubtree(app: App, path: string, line: number, expectedHead: string): Promise<TFile[]> {
    const file = app.vault.getFileByPath(path)
    if (!file) throw new StaleLineError()
    await app.vault.process(file, c => cutSubtree(c, line, expectedHead).content)
    return [file]
}

/** Deletes heading `line` of `path` and its section (cutHeadingSection); throws StaleLineError like deleteSubtree. */
export async function deleteHeadingSection(app: App, path: string, line: number, expectedHead: string): Promise<TFile[]> {
    const file = app.vault.getFileByPath(path)
    if (!file) throw new StaleLineError()
    await app.vault.process(file, c => cutHeadingSection(c, line, expectedHead))
    return [file]
}

/** Moves the file at `path` to the trash (Obsidian's "Deleted files" setting); throws StaleLineError if it is gone. */
export async function trashVaultFile(app: App, path: string): Promise<void> {
    const file = app.vault.getAbstractFileByPath(path)
    if (!file) throw new StaleLineError()
    await app.fileManager.trashFile(file)
}

export type TaskChange = { kind: "done"; done: boolean } | { kind: "schedule"; when: RescheduleKind } | { kind: "unschedule" }

/** Completes/reopens, reschedules or unschedules a task row's line (Tasks plugin Dataview fields); completing and
 *  unscheduling also apply to the open tasks nested under it. Throws StaleLineError, writing nothing, when the line at
 *  the row's location no longer is that task (open, for a reschedule or an unschedule). */
export async function editTaskLine(app: App, node: TextNode, change: TaskChange, now: Date = new Date()): Promise<TFile[]> {
    const {path, position: {start: {line}}} = node.location
    const current = await readLine(app, path, line)
    if (current === null || !lineHasIdentity(current, node)) throw new StaleLineError()
    const edit: TaskLineEdit = change.kind === "done" ? {kind: "done", done: change.done, today: localIsoDate(now)}
        : change.kind === "schedule" ? {kind: "schedule", date: rescheduleDate(change.when, now)}
        : {kind: "unschedule"}
    const file = app.vault.getFileByPath(path)
    if (!file) throw new StaleLineError()
    await app.vault.process(file, c => applyTaskEdit(c, line, current, edit))
    return [file]
}

const linkName = (entry: string): string => (entry.match(/\[\[([^\]|#]+)/)?.[1] ?? entry).trim()

/** Cuts the already-copied subtree from `source`; a changed line becomes an error naming where the copy went. */
async function cutAfterCopy(app: App, source: TFile, line: number, head: string, copiedTo: string): Promise<void> {
    try {
        await app.vault.process(source, c => cutSubtree(c, line, head).content)
    } catch (e) {
        if (!(e instanceof StaleLineError)) throw e
        throw new Error(`Copied to ${copiedTo} but the original line changed — remove it manually`)
    }
}

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

    if (plan.kind === "set-parent") {
        let child: TFile | null
        if (plan.childPath === null) {
            child = await noteFileFor(app, plan.childName, dailyNotePath(plan.cfg))
        } else {
            child = app.vault.getFileByPath(plan.childPath)
            if (!child) throw new StaleLineError()
        }
        const link = `[[${plan.newName}]]`
        const oldName = plan.oldName?.toLowerCase()
        await app.fileManager.processFrontMatter(child, fm => {
            const raw = fm[plan.relation]
            if (raw == null) {
                fm[plan.relation] = link
                return
            }
            const entries: string[] = Array.isArray(raw) ? raw.map(String) : [String(raw)]
            const i = oldName === undefined ? -1 : entries.findIndex(e => linkName(e).toLowerCase() === oldName)
            if (i >= 0) entries[i] = link
            else if (Array.isArray(raw)) entries.push(link)
            else entries[0] = link
            fm[plan.relation] = Array.isArray(raw) ? entries : entries[0]
        })
        return [child]
    }

    if (plan.kind === "to-folder") {
        // A note, an attachment or a folder; the returned notes are the moved one (a folder's notes need a full reindex).
        const item = app.vault.getAbstractFileByPath(plan.childPath)
        if (!item) throw new StaleLineError()
        const dest = plan.folderPath === "/" ? item.name : `${plan.folderPath}/${item.name}`
        if (app.vault.getAbstractFileByPath(dest)) throw new Error(`${item.name} already exists in ${plan.folderPath}`)
        await app.fileManager.renameFile(item, dest)
        const moved = app.vault.getFileByPath(dest)
        return moved ? [moved] : []
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

    if (plan.kind === "to-daily") {
        const daily = await getOrCreateDailyNote(app, plan.cfg)
        if (daily.path === plan.sourcePath) {
            await app.vault.process(daily, c => {
                const cut = cutSubtree(c, plan.line, plan.head)
                return pasteUnderLinkBullet(cut.content, plan.parentLink, cut.block)
            })
            return [daily]
        }
        // Copy first, then cut, so nothing is lost if the cut guard fails.
        const {block} = cutSubtree(await app.vault.read(source), plan.line, plan.head)
        const moved = plan.stampDate ? stampMovedBlock(block, plan.stampDate) : block
        await app.vault.process(daily, c => pasteUnderLinkBullet(c, plan.parentLink, moved))
        await cutAfterCopy(app, source, plan.line, plan.head, "today's daily note")
        return [daily, source]
    }

    if (plan.kind === "under-line") {
        if (plan.targetPath === plan.sourcePath) {
            await app.vault.process(source, c => {
                const cut = cutSubtree(c, plan.line, plan.head)
                let target = plan.targetLine
                if (plan.line <= target && target < plan.line + cut.block.length) throw new Error("Can't move a line under itself")
                if (target >= plan.line + cut.block.length) target -= cut.block.length
                return pasteUnderLine(cut.content, target, plan.targetHead, cut.block).content
            })
            return [source]
        }
        const dest = app.vault.getFileByPath(plan.targetPath)
        if (!dest) throw new StaleLineError()
        const {block} = cutSubtree(await app.vault.read(source), plan.line, plan.head)
        const moved = plan.stampDate ? stampMovedBlock(block, plan.stampDate) : block
        await app.vault.process(dest, c => pasteUnderLine(c, plan.targetLine, plan.targetHead, moved).content)
        await cutAfterCopy(app, source, plan.line, plan.head, dest.basename)
        return [dest, source]
    }

    // Cross-file: copy to the destination first, then cut, so nothing is lost if the cut guard fails.
    const {block} = cutSubtree(await app.vault.read(source), plan.line, plan.head)
    const moved = plan.stampDate ? stampMovedBlock(block, plan.stampDate) : block
    const dest = await noteFileFor(app, plan.newName, plan.sourcePath)
    await app.vault.process(dest, c => pasteAtOutlineEnd(c, moved))
    await cutAfterCopy(app, source, plan.line, plan.head, `[[${plan.newName}]]`)
    return [dest, source]
}

export async function readLine(app: App, path: string, line: number): Promise<string | null> {
    const file = app.vault.getFileByPath(path)
    if (!file) return null
    return splitLines(await app.vault.read(file)).lines[line] ?? null
}
