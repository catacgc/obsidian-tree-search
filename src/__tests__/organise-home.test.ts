import { describe, it, expect } from "bun:test"
import { NotesGraph, type PageNode } from "@mdtree/core"
import { resolveHome } from "../obsidian-utils"

function makePage(name: string, path: string, isReference: boolean): PageNode {
    return {
        nodeType: "page",
        isReference,
        page: name,
        aliases: [],
        tags: [],
        location: { path, position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } } },
        searchKey: name.toLowerCase(),
        boost: 1,
        ageDays: 0,
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeApp(existingPaths: string[]): any {
    return {
        vault: {
            getFileByPath: (path: string) => (existingPaths.includes(path) ? { path } : null),
        },
    }
}

describe("resolveHome", () => {
    it("uses a real page's own file as its home", () => {
        const g = new NotesGraph()
        g.addOrUpdateNode(makePage("Child", "Notes/Child.md", false))

        const home = resolveHome(fakeApp([]), g, "[[child]]", "Notes/Parent.md")

        expect(home).toEqual({ path: "Notes/Child.md", exists: true })
    })

    it("computes a same-folder candidate for a virtual reference with no file yet", () => {
        const g = new NotesGraph()
        g.addOrUpdateNode(makePage("Child", "Daily/2025-03-20.md", true))

        const home = resolveHome(fakeApp([]), g, "[[child]]", "Notes/Parent.md")

        expect(home).toEqual({ path: "Notes/Child.md", exists: false })
    })

    it("marks exists:true when a file already sits at the candidate path", () => {
        const g = new NotesGraph()
        g.addOrUpdateNode(makePage("Child", "Daily/2025-03-20.md", true))

        const home = resolveHome(fakeApp(["Notes/Child.md"]), g, "[[child]]", "Notes/Parent.md")

        expect(home).toEqual({ path: "Notes/Child.md", exists: true })
    })

    it("uses the vault root when the organising note has no folder", () => {
        const g = new NotesGraph()
        g.addOrUpdateNode(makePage("Child", "Daily.md", true))

        const home = resolveHome(fakeApp([]), g, "[[child]]", "Parent.md")

        expect(home).toEqual({ path: "Child.md", exists: false })
    })
})
