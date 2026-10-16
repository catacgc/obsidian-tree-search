import { describe, it, expect } from "bun:test"
import type { ParsedNode } from "@mdtree/core"
import type { EditorState } from "../view/editor/EditorMolecule"
import type { OutlineRoot, OutlineState } from "../view/search/outline"
import { searchModalTitle } from "../view/editor/draft"

const session = (over: Partial<EditorState>): EditorState => ({
    sessionId: 1, mode: "edit", sourcePath: "Notes/Project X.md", outline: "", caret: 0,
    contents: {}, contentOrder: [], activeContent: null, attachments: [], doneSteps: [], touchedPaths: [], saving: false,
    ...over,
})

const outline = (path: OutlineRoot[], over: Partial<OutlineState> = {}): OutlineState =>
    ({ path, filters: [], prevQuery: "", returnTo: [], quickAdd: false, pins: [], mode: "edit", ...over })
const node = (label: string): OutlineRoot => ({ kind: "node", node: null as unknown as ParsedNode, label })

describe("searchModalTitle", () => {
    it("names a Rename or filter session after the editor, over an open outline", () => {
        expect(searchModalTitle(session({ editKind: "file", sourcePath: "assets/photo.png", originalLine: "photo.png" }), null)).toBe("Rename photo.png")
        expect(searchModalTitle(session({ editKind: "filter", filterQuery: "is:task" }), outline([node("P")]))).toBe('Save Filter "is:task"')
    })

    it("names the outline editor after its root", () => {
        expect(searchModalTitle(null, outline([node("Project X"), node("Plan")]))).toBe("Edit Plan")
        expect(searchModalTitle(null, outline([{ kind: "today" }]))).toBe("Edit Today")
    })

    it("names the outline editor at the search root after the query", () => {
        expect(searchModalTitle(null, outline([], { prevQuery: " is:task " }))).toBe('Edit "is:task"')
        expect(searchModalTitle(null, outline([], { prevQuery: "  " }))).toBe("Edit search")
    })

    it("names a Quick Add session Quick Add only while at Today", () => {
        expect(searchModalTitle(null, outline([{ kind: "today" }], { quickAdd: true }))).toBe("Quick Add")
        expect(searchModalTitle(null, outline([{ kind: "today" }, node("call Bob")], { quickAdd: true }))).toBe("Edit call Bob")
    })

    it("stays Search for Append and prose editors, and plain searching", () => {
        expect(searchModalTitle(null, null)).toBe("Search")
        expect(searchModalTitle(session({ mode: "append" }), null)).toBe("Search")
        expect(searchModalTitle(session({ mode: "prose", prose: { kind: "note", path: "P.md", original: "" } }), null)).toBe("Search")
    })
})
