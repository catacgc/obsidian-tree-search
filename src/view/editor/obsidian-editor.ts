// Access to Obsidian's own markdown editor (CodeMirror 6 with live preview). Obsidian has no
// public API for embedding it; the class is recovered from a throwaway markdown embed the same
// way mgmeyers/obsidian-kanban does it (`src/main.ts`, `getEditorClass`). This is the only
// module that touches that private API.
import type {App, Editor} from "obsidian";
import type {Extension} from "@codemirror/state";
import type {EditorView, ViewUpdate} from "@codemirror/view";

export interface EmbeddedEditor {
    cm: EditorView
    editor: Editor
    set(text: string, clear: boolean): void
    load(): void
    unload(): void
    buildLocalExtensions(): Extension[]
    onUpdate(update: ViewUpdate, changed: boolean): void
}

export type EmbeddedEditorClass = new (app: App, containerEl: HTMLElement, owner: object) => EmbeddedEditor

const UNAVAILABLE = "Tree Search: this Obsidian version doesn't expose its markdown editor"

let cached: EmbeddedEditorClass | null = null

/** The class behind a note's edit mode (`MarkdownEditView`'s base), recovered from a throwaway embed. */
export function embeddedEditorClass(app: App): EmbeddedEditorClass {
    if (cached) return cached
    // Private API: `embedRegistry` isn't declared in obsidian.d.ts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const privateApp = app as any
    const embed = privateApp.embedRegistry?.embedByExtension?.md?.({app, containerEl: createDiv(), state: {}}, null, "")
    if (!embed) throw new Error(UNAVAILABLE)
    embed.load()
    embed.editable = true
    embed.showEditor()
    const mode = embed.editMode
    embed.unload()
    if (!mode) throw new Error(UNAVAILABLE)
    cached = Object.getPrototypeOf(Object.getPrototypeOf(mode)).constructor as EmbeddedEditorClass
    return cached
}

const HIDDEN_CONFIG = new Set(["showLineNumber", "foldHeading", "foldIndent"])

// Stands in for `workspace.editorSuggest`, which the editor grabs in its constructor and triggers on
// every update: the field's links are suggested by the compact tree only. Members: those the editor uses.
const NO_EDITOR_SUGGEST = {trigger() {}, close() {}, reposition() {}, isShowingSuggestion: () => false}

/** `app` as the editor sees it (Kanban's `getEditorAppProxy`): no line numbers and no fold indicators,
 *  no Obsidian `[[` suggest, and focusing the field doesn't make it `workspace.activeEditor` (the
 *  editor's focus handler sets it). */
export function editorAppProxy(app: App): App {
    return new Proxy(app, {
        get(target, prop, receiver) {
            if (prop === "workspace") {
                return new Proxy(target.workspace, {
                    get: (ws, key, r) => key === "editorSuggest" ? NO_EDITOR_SUGGEST : Reflect.get(ws, key, r),
                    set: (ws, key, value, r) => key === "activeEditor" || Reflect.set(ws, key, value, r),
                })
            }
            if (prop !== "vault") return Reflect.get(target, prop, receiver)
            return new Proxy(target.vault, {
                get(vault, vprop, vreceiver) {
                    if (vprop !== "config") return Reflect.get(vault, vprop, vreceiver)
                    const config = Reflect.get(vault, vprop, vreceiver) as object
                    return new Proxy(config, {
                        get: (c, key, r) => typeof key === "string" && HIDDEN_CONFIG.has(key) ? false : Reflect.get(c, key, r),
                    })
                },
            })
        },
    })
}

/** Obsidian's "Auto convert HTML" setting (Settings → Editor). */
export function autoConvertHtml(app: App): boolean {
    const vault: object = app.vault
    return "getConfig" in vault && typeof vault.getConfig === "function" && vault.getConfig("autoConvertHtml") === true
}
