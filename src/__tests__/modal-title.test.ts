import { describe, it, expect } from "bun:test"
import type { EditorState } from "../view/editor/EditorMolecule"
import type { ChainState } from "../view/search/chain"
import { editorTitle, searchModalTitle } from "../view/editor/draft"

const session = (over: Partial<EditorState>): EditorState => ({
    sessionId: 1, mode: "edit", sourcePath: "Notes/Project X.md", outline: "", caret: 0,
    contents: {}, contentOrder: [], activeContent: null, attachments: [], doneSteps: [], touchedPaths: [], saving: false,
    ...over,
})

const patch: ChainState = {
    mode: "append",
    steps: [
        { kind: "row", anchor: { kind: "note", name: "Project X" }, label: "Project X", prevQuery: "" },
        { kind: "row", anchor: { kind: "header", page: "Project X", header: "Plan" }, label: "Project X#Plan", prevQuery: "" },
        { kind: "entry", entry: { kind: "alias", alias: "px" }, label: "|px", prevQuery: "" },
    ],
}

describe("searchModalTitle", () => {
    it("names an Alt-Edit session: Edit for a line, Rename for a heading or a file", () => {
        expect(searchModalTitle(session({ editKind: "list", line: 11 }), null)).toBe("Edit Project X:12")
        expect(searchModalTitle(session({ editKind: "heading", originalLine: "## Plan " }), null)).toBe("Rename Project X#Plan")
        expect(searchModalTitle(session({ editKind: "file", sourcePath: "assets/photo.png", originalLine: "photo.png" }), null)).toBe("Rename photo.png")
    })

    it("names an append chain after its last row chip, before any entry chips", () => {
        expect(searchModalTitle(null, patch)).toBe("Patch Project X#Plan")
    })

    it("names Quick Add until its first row chip", () => {
        expect(searchModalTitle(null, { mode: "append", steps: [], quickAdd: { prevQuery: "" } })).toBe("Quick Add")
        expect(searchModalTitle(null, { ...patch, quickAdd: { prevQuery: "" } })).toBe("Patch Project X#Plan")
    })

    it("stays Search for reparent, Append and prose editors, and plain searching", () => {
        expect(searchModalTitle(null, null)).toBe("Search")
        expect(searchModalTitle(null, { mode: "reparent", child: { node: null as never, label: "x", parent: null }, prevQuery: "", confirm: null })).toBe("Search")
        expect(searchModalTitle(session({ mode: "append" }), null)).toBe("Search")
        expect(searchModalTitle(session({ mode: "prose", prose: { kind: "note", path: "P.md", original: "" } }), null)).toBe("Search")
    })
})
