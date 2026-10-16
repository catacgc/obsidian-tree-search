import {afterEach, describe, expect, it} from "bun:test"
import {createStore} from "jotai/vanilla"
import {createInjector} from "bunshi"
import {NotesGraph, type ParsedNode, type ParsedTextToken, type ResultNode} from "@mdtree/core"
import type {App} from "obsidian"
import {EditorMolecule} from "../view/editor/EditorMolecule"
import {GlobalAtoms} from "../view/react-context/global"
import {GlobalAppScope, SearchViewMolecule, SearchViewScope} from "../view/react-context/state"
import type {TreeNode} from "../view/search/SearchViewFlatten"

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })

const location = (path: string, line: number) => ({
    path,
    position: {start: {line, ch: 0}, end: {line, ch: 1}},
})
const base = (path: string, line: number) => ({searchKey: "", location: location(path, line), boost: 0, ageDays: 0})

const page = (name: string, path: string, line = 0, isReference = false): ParsedNode => ({
    ...base(path, line), nodeType: "page", isReference, page: name, aliases: [], tags: [],
})
const header = (name: string, path: string, line: number): ParsedNode => ({
    ...base(path, line), nodeType: "header", page: "Project", header: name, indent: 0,
})
const text = (value: string, path: string, line: number, nested = false): ParsedNode => {
    const parsedTokens: ParsedTextToken[] = [{tokenType: "text", text: value, decoration: "none"}]
    return {
        ...base(path, line), searchKey: value.toLowerCase(), nodeType: "text", parsedTokens,
        tags: [], isTask: false, isCompleted: false, ...(nested ? {nested: true as const} : {}),
    }
}
const attachment = (path: string): ParsedNode => ({
    ...base(path, 0), nodeType: "attachment", name: path.slice(path.lastIndexOf("/") + 1), extension: "png", aliases: [],
})
const resultNode = (node: ParsedNode, children: ResultNode[] = []): ResultNode => ({node, children, parents: []})

function makeApp(contents: Record<string, string>) {
    const files = new Map(Object.entries(contents))
    const fileFor = (path: string) => {
        const name = path.slice(path.lastIndexOf("/") + 1)
        const dot = name.lastIndexOf(".")
        return {path, name, basename: dot > 0 ? name.slice(0, dot) : name, extension: dot > 0 ? name.slice(dot + 1) : ""}
    }
    const app = {
        vault: {
            getFileByPath: (path: string) => files.has(path) ? fileFor(path) : null,
            read: async (file: {path: string}) => files.get(file.path) ?? "",
        },
    } as unknown as App
    return app
}

function setup(contents: Record<string, string>, graphNodes: ParsedNode[], results: ResultNode[]) {
    const app = makeApp(contents)
    const graph = new NotesGraph()
    for (const node of graphNodes) graph.addOrUpdateNode(node)
    const store = createStore()
    const injector = createInjector()
    const viewScope = {
        name: "modal", isQuickLink: false, showSearch: true, isModal: true, allowTimeline: false, allowEditing: true,
    }
    const [view, stopView] = injector.use(SearchViewMolecule, [SearchViewScope, viewScope], [GlobalAppScope, {obsidianApp: app}])
    const [editor, stopEditor] = injector.use(EditorMolecule, [SearchViewScope, viewScope], [GlobalAppScope, {obsidianApp: app}])
    cleanups.push(stopEditor, stopView)
    store.set(GlobalAtoms.appAtom, app)
    store.set(GlobalAtoms.graphAtom, graph)
    store.set(view.updateSearchResultsAtom, results)
    const first = store.get(view.renderableTreeNodesAtom)[0]
    if (!first) throw new Error("The test result did not produce a row")
    store.set(view.selectedLineAtom, first.index)
    return {store, view, editor}
}

describe("editAtom", () => {
    it("opens Rename for a selected page's own file without opening the outline", async () => {
        const project = page("Project", "Project.md")
        const {store, view, editor} = setup({"Project.md": "# Project\n"}, [project], [resultNode(project)])

        await store.set(editor.editAtom)

        expect(store.get(GlobalAtoms.editSessionAtom)).toMatchObject({editKind: "file", sourcePath: "Project.md", outline: "Project"})
        expect(store.get(view.outlineAtom)).toBeNull()
        expect(store.get(view.lineEditAtom)).toBeNull()
    })

    it("opens the selected heading's source line inline", async () => {
        const plan = header("Plan", "Project.md", 1)
        const {store, view, editor} = setup({"Project.md": "# Project\n## Plan\n"}, [], [resultNode(plan)])

        await store.set(editor.editAtom)

        expect(store.get(view.lineEditAtom)).toMatchObject({row: {expectedLine: "## Plan", heading: true}, prefix: "## ", text: "Plan"})
        expect(store.get(view.outlineAtom)).toBeNull()
    })

    it("opens the selected text row's source line inline", async () => {
        const item = text("note to self", "Project.md", 1)
        const {store, view, editor} = setup({"Project.md": "# Project\n- note to self\n"}, [], [resultNode(item)])

        await store.set(editor.editAtom)

        expect(store.get(view.lineEditAtom)).toMatchObject({row: {expectedLine: "- note to self", heading: false}, prefix: "- ", text: "note to self"})
        expect(store.get(view.outlineAtom)).toBeNull()
    })

    it("edits a page-link row's source line instead of renaming the target", async () => {
        const project = page("Project", "Project.md")
        const mention = page("Project", "Daily.md", 1, true)
        const {store, view, editor} = setup({
            "Project.md": "# Project\n",
            "Daily.md": "# Today\n- [[Project]]\n",
        }, [project], [resultNode(mention)])

        await store.set(editor.editAtom)

        expect(store.get(view.lineEditAtom)).toMatchObject({row: {path: "Daily.md", expectedLine: "- [[Project]]", heading: false}, text: "[[Project]]"})
        expect(store.get(GlobalAtoms.editSessionAtom)).toBeNull()
        expect(store.get(view.outlineAtom)).toBeNull()
    })

    it("edits a selected text row with children directly", async () => {
        const parent = text("parent task", "Project.md", 0, true)
        const child = text("child task", "Project.md", 1)
        const {store, view, editor} = setup({"Project.md": "- parent task\n    - child task\n"}, [], [resultNode(parent, [resultNode(child)])])

        expect(store.get(view.selectedNodeAtom)?.hasChildren).toBe(true)
        await store.set(editor.editAtom)

        expect(store.get(view.lineEditAtom)).toMatchObject({row: {expectedLine: "- parent task"}, text: "parent task"})
        expect(store.get(view.outlineAtom)).toBeNull()
    })
    it("uses the Enter-row fallback when Alt+Enter has no outline selection", async () => {
        const item = text("first row", "Project.md", 0)
        const {store, view, editor} = setup({"Project.md": "- first row\n"}, [], [resultNode(item)])
        store.set(view.outlineAtom, {path: [], filters: [], prevQuery: "", returnTo: [], quickAdd: false, pins: []})
        store.set(view.selectedLineAtom, -1)

        expect(store.get(view.selectedNodeAtom)).toBeNull()
        expect(store.get(view.enterRowAtom)?.node).toEqual(item)
        await store.set(editor.editAtom)

        expect(store.get(view.lineEditAtom)).toMatchObject({row: {expectedLine: "- first row"}, text: "first row"})
        expect(store.get(view.outlineAtom)).toMatchObject({path: []})
    })

    it("keeps attachment Edit as Rename", async () => {
        const photo = attachment("assets/photo.png")
        const {store, view, editor} = setup({"assets/photo.png": "binary"}, [], [resultNode(photo)])

        await store.set(editor.editAtom)

        expect(store.get(GlobalAtoms.editSessionAtom)).toMatchObject({editKind: "file", sourcePath: "assets/photo.png", outline: "photo"})
        expect(store.get(view.outlineAtom)).toBeNull()
    })

    it("does nothing for a page row without a resolvable own file", async () => {
        const missing = page("Missing", "Missing.md")
        const {store, view, editor} = setup({}, [], [resultNode(missing)])

        await store.set(editor.editAtom)

        expect(store.get(GlobalAtoms.editSessionAtom)).toBeNull()
        expect(store.get(view.lineEditAtom)).toBeNull()
        expect(store.get(view.outlineAtom)).toBeNull()
    })
})
