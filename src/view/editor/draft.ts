// The editor's sessions: builders shared by EditorMolecule and quick-add-flow, and the
// data.json form of the Append draft (settings.ts), which outlives the editor until it is
// saved or discarded.
import type {EditorState, UnderLine} from "./EditorMolecule"
import type {ChainState} from "../search/chain"
import type {DailyNoteConfig} from "../../indexing/indexed-tree"
import {appendPrefill} from "./textarea-ops"
import {INVALID_NAME_RE} from "@mdtree/core"

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

/** A new Append draft whose outline Save writes under `underLine`'s line, in that line's file. */
export function newUnderLineState(sourcePath: string, underLine: UnderLine): EditorState {
    return {...emptySession(), mode: "append", sourcePath, underLine, outline: "- ", caret: 2}
}

/** A Rename session for the file at `path` named `name`: the outline holds the name without its extension. */
export function fileRenameState(path: string, name: string): EditorState {
    const dot = name.lastIndexOf(".")
    const stem = dot > 0 ? name.slice(0, dot) : name
    return {...emptySession(), mode: "edit", editKind: "file", sourcePath: path, originalLine: name, outline: stem, caret: stem.length}
}

const INVALID_NAME_CHARS = new RegExp(INVALID_NAME_RE.source, "g")

/** A new note's name from pasted prose: its first non-blank line without heading/bullet/checkbox markers or
 *  characters a name can't hold, cut to 60 characters; "" when nothing is left. */
export function proseNameFrom(text: string): string {
    const first = text.split(/\r?\n/).find(l => l.trim() !== "") ?? ""
    return first.trim()
        .replace(/^#+\s*/, "")
        .replace(/^[-*+]\s+/, "")
        .replace(/^\[[ xX]\]\s+/, "")
        .replace(INVALID_NAME_CHARS, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60)
        .trim()
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

/** The editor's title (rendered by InlineEditor in every host): `Add to <daily basename>`, `Add under "<line>"` for
 *  an Append under a picked line, `Edit <file basename>:<1-based line>` for an Alt-Edit session (`Rename <note>#<heading>`
 *  for a heading, `Rename <file name>` for an attachment), `Write <note basename>` / `New note from <file
 *  basename>:<1-based line>` for a prose session. */
export function editorTitle(s: EditorState | null): string {
    if (!s) return "Quick Add"
    if (s.prose?.kind === "note") return `Write ${basenameOf(s.prose.path)}`
    if (s.prose?.kind === "new") return `New note from ${basenameOf(s.prose.link.path)}:${s.prose.link.line + 1}`
    if (s.mode === "append" && s.underLine) return `Add under "${s.underLine.label}"`
    if (s.mode !== "edit") return `Add to ${basenameOf(s.sourcePath)}`
    if (s.editKind === "file") return `Rename ${s.originalLine}`
    if (s.editKind === "heading") return `Rename ${basenameOf(s.sourcePath)}#${(s.originalLine ?? "").replace(/^#+\s*/, "").trim()}`
    return `Edit ${basenameOf(s.sourcePath)}:${(s.line ?? 0) + 1}`
}

/** The Search modal's title: what the modal is doing. An Alt-Edit session shown in it takes the editor's title (Edit /
 *  Rename), an append chain (`>`) is `Patch <anchor chip>`, anything else `Search`. */
export function searchModalTitle(session: EditorState | null, chain: ChainState | null): string {
    if (session?.mode === "edit") return editorTitle(session)
    if (chain?.mode === "append") {
        const anchor = chain.steps.filter(s => s.kind === "row").pop()
        if (anchor) return `Patch ${anchor.label}`
    }
    return "Search"
}
