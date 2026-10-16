// The editor's sessions: builders shared by EditorMolecule and quick-add-flow, and the
// data.json form of the Append draft (settings.ts), which outlives the editor until it is
// saved or discarded.
import type {EditorState} from "./EditorMolecule"
import {outlineTitle, type OutlineState} from "../search/outline"
import type {DailyNoteConfig} from "../../indexing/indexed-tree"
import {appendPrefill} from "./textarea-ops"

export const DEFAULT_DAILY: DailyNoteConfig = {folder: "", format: "YYYY-MM-DD", template: ""}

let lastSessionId = 0
export const nextSessionId = () => (lastSessionId = Math.max(lastSessionId + 1, Date.now()))

export const basenameOf = (path: string) => path.split("/").pop()!.replace(/\.md$/, "")

export const dailyConfigOf = (index: {getDailyNoteConfig(): DailyNoteConfig} | null): DailyNoteConfig =>
    index?.getDailyNoteConfig() ?? DEFAULT_DAILY

/** Fields every new session starts with. */
export const emptySession = () => ({
    sessionId: nextSessionId(),
    contents: {}, contentOrder: [], activeContent: null,
    attachments: [], doneSteps: [], touchedPaths: [], saving: false,
})

/** A new Append draft for `sourcePath`: `- [[parentName]]\n    - ` (appendPrefill) with a parent, else `- `. Caret at the end. */
export function newAppendState(sourcePath: string, parentName?: string): EditorState {
    const outline = parentName ? appendPrefill(parentName) : "- "
    return {...emptySession(), mode: "append", parentName, sourcePath, outline, caret: outline.length}
}

/** A Rename session for the file at `path` named `name`: the outline holds the name without its extension. */
export function fileRenameState(path: string, name: string): EditorState {
    const dot = name.lastIndexOf(".")
    const stem = dot > 0 ? name.slice(0, dot) : name
    return {...emptySession(), mode: "edit", editKind: "file", sourcePath: path, originalLine: name, outline: stem, caret: stem.length}
}

/** A Save as Filter session for `query`: the outline holds the filter's name, empty to start. */
export function saveFilterState(query: string): EditorState {
    return {...emptySession(), mode: "edit", editKind: "filter", sourcePath: "", filterQuery: query, outline: "", caret: 0}
}

/** A Rename Filter session for `filter`: the outline holds its name, caret at the end. */
export function renameFilterState(filter: {name: string; query: string}): EditorState {
    return {...emptySession(), mode: "edit", editKind: "filter", sourcePath: "", originalLine: filter.name, filterQuery: filter.query, outline: filter.name, caret: filter.name.length}
}

/** data.json form of the Append draft: everything but the session id, mode and in-flight flag. */
export type PersistedDraft = Omit<EditorState, "sessionId" | "mode" | "saving">

export function draftToData(s: EditorState | null): PersistedDraft | undefined {
    if (!s) return undefined
    const {sessionId: _id, mode: _mode, saving: _saving, ...draft} = s
    return draft
}

export function draftFromData(d: PersistedDraft | undefined): EditorState | null {
    return d ? {...d, mode: "append", sessionId: nextSessionId(), saving: false} : null
}

/** The editor's title (rendered by InlineEditor in every host): `Add to <daily basename>`, `Rename <file name>` for
 *  an attachment (`Save Filter "<query>"` for Save as Filter, `Rename Filter "<name>"`), `Write <note basename>` for
 *  a prose session. */
export function editorTitle(s: EditorState | null): string {
    if (!s) return "Quick Add"
    if (s.prose?.kind === "note") return `Write ${basenameOf(s.prose.path)}`
    if (s.mode !== "edit") return `Add to ${basenameOf(s.sourcePath)}`
    if (s.editKind === "filter") return s.originalLine !== undefined ? `Rename Filter "${s.originalLine}"` : `Save Filter "${s.filterQuery}"`
    return `Rename ${s.originalLine}`
}

/** The Search modal's title: what the modal is doing. A Rename / filter session shown in it takes the editor's title,
 *  the outline editor its own (outlineTitle), anything else `Search`. */
export function searchModalTitle(session: EditorState | null, outline: OutlineState | null): string {
    if (session?.mode === "edit") return editorTitle(session)
    if (outline) return outlineTitle(outline)
    return "Search"
}
