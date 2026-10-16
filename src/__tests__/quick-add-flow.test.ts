import { describe, it, expect } from "bun:test"
import { createStore } from "jotai"
import type { App } from "obsidian"
import { GlobalAtoms } from "../view/react-context/global"
import { appendDraftAtom } from "../view/react-context/settings"
import { applyEditorRequestAtom } from "../view/react-context/quick-add-flow"
import { dailyConfigOf, newAppendState } from "../view/editor/draft"
import { dailyNotePath } from "../editing/vault-edits"
import type { EditorState } from "../view/editor/EditorMolecule"

function setup(draft: EditorState | null) {
    const trashed: string[] = []
    const store = createStore()
    store.set(GlobalAtoms.appAtom, {
        vault: { getFileByPath: (p: string) => ({ path: p }) },
        fileManager: { trashFile: async (f: { path: string }) => { trashed.push(f.path) } },
    } as unknown as App)
    store.set(appendDraftAtom, draft)
    // trashSessionAttachments calls trashFile before its first await, so `trashed` is filled synchronously.
    const appendTo = (name: string) => store.set(applyEditorRequestAtom, { kind: "link", name })
    return { store, trashed, appendTo }
}

function draftUnder(parent: string): EditorState {
    const outline = `- [[${parent}]]\n    - x`
    return {
        ...newAppendState("2020-01-01.md", parent),
        outline,
        caret: outline.length,
        attachments: [{ name: `${parent} image`, ext: "png", path: `${parent} image.png` }],
    }
}

describe("Append to [[name]]", () => {
    const today = dailyNotePath(dailyConfigOf(null))

    it("replaces a draft aimed at another parent, trashing its pasted attachments", () => {
        const { store, trashed, appendTo } = setup(draftUnder("P"))
        appendTo("Q")
        const d = store.get(appendDraftAtom)!
        expect(d.parentName).toBe("Q")
        expect(d.outline).toBe("- [[Q]]\n    - ")
        expect(d.attachments).toEqual([])
        expect(trashed).toEqual(["P image.png"])
    })

    it("keeps a draft already aimed at the parent, matching its name case-insensitively", () => {
        const before = draftUnder("P")
        const { store, trashed, appendTo } = setup(before)
        appendTo("p")
        const d = store.get(appendDraftAtom)!
        expect(d.outline).toBe(before.outline)
        expect(d.caret).toBe(before.caret)
        expect(d.sourcePath).toBe(today)
        expect(trashed).toEqual([])
    })

    it("replaces a blank draft with one prefilled under the parent", () => {
        const { store, appendTo } = setup(newAppendState("x.md"))
        appendTo("Q")
        expect(store.get(appendDraftAtom)).toMatchObject({ parentName: "Q", outline: "- [[Q]]\n    - ", sourcePath: today })
    })
})
