// Quick Add's editor sessions: builders shared by EditorMolecule and quick-add-flow,
// and the data.json form of the Append draft (settings.ts), which outlives Quick Add
// until it is saved or discarded.
import type {EditorState} from "./EditorMolecule"
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

/** Quick Add's modal title: `Add to <daily basename>`, or `Edit <file basename>:<1-based line>` for an Alt-Edit session. */
export function quickAddTitle(s: EditorState | null): string {
    if (!s) return "Quick Add"
    return s.mode === "edit" ? `Edit ${basenameOf(s.sourcePath)}:${(s.line ?? 0) + 1}` : `Add to ${basenameOf(s.sourcePath)}`
}
