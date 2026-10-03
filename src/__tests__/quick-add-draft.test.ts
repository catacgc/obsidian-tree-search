import { describe, it, expect } from "bun:test"
import { createStore } from "jotai"
import { appendDraftAtom, getPluginData, updateSettings, type PluginData } from "../view/react-context/settings"
import type { GlobalStore } from "../view/react-context/global"
import type { EditorState } from "../view/editor/EditorMolecule"

const draft = (): EditorState => ({
    sessionId: 1,
    mode: "append",
    parentName: "P",
    sourcePath: "Daily/2024-01-02.md",
    outline: "- [[P]]\n    - x",
    caret: 14,
    contents: { Notes: "body" },
    contentOrder: ["Notes"],
    activeContent: "Notes",
    attachments: [{ name: "P image", ext: "png", path: "P image.png" }],
    doneSteps: ["attachments"],
    touchedPaths: [],
    saving: true,
})

const throughJson = (store: GlobalStore): PluginData => JSON.parse(JSON.stringify(getPluginData(store)))

describe("Quick Add draft in data.json", () => {
    it("survives a save/load round trip as an idle Append draft", () => {
        const a = createStore()
        a.set(appendDraftAtom, draft())
        const b = createStore()
        updateSettings(b, throughJson(a))

        const restored = b.get(appendDraftAtom)!
        const { sessionId: _a, saving: _b, ...rest } = draft()
        expect(restored).toMatchObject({ ...rest, mode: "append", saving: false })
    })

    it("is absent from data.json when there is no draft", () => {
        const store = createStore()
        expect("quickAddDraft" in throughJson(store)).toBe(false)
    })

    it("loading data.json without a draft clears the current one", () => {
        const store = createStore()
        store.set(appendDraftAtom, draft())
        updateSettings(store, throughJson(createStore()))
        expect(store.get(appendDraftAtom)).toBeNull()
    })
})
