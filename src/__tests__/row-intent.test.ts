import { describe, it, expect } from "bun:test"
import type { ParsedNode, ParsedTextToken } from "@mdtree/core"
import { rowIntent, snippetOf } from "../view/search/row-intent"
import type { Browse } from "../view/node-actions"

const loc = (path: string, line: number) => ({ path, position: { start: { line, ch: 0 }, end: { line, ch: 0 } } })
const base = (path: string, line: number) => ({ searchKey: "", location: loc(path, line), boost: 0, ageDays: 0 })
const page = (name: string): ParsedNode =>
    ({ ...base(`${name}.md`, 0), nodeType: "page", isReference: false, page: name, aliases: [], tags: [] })
const header = (pageName: string, h: string): ParsedNode =>
    ({ ...base(`${pageName}.md`, 3), nodeType: "header", page: pageName, header: h, indent: 1 })
const plain = (text: string): ParsedTextToken => ({ tokenType: "text", text, decoration: "none" })
const code = (text: string): ParsedTextToken => ({ tokenType: "text", text, decoration: "code" })
const line = (tokens: ParsedTextToken[], task?: { done: boolean }): ParsedNode =>
    ({ ...base("P.md", 5), nodeType: "text", parsedTokens: tokens, tags: [], isTask: task !== undefined, isCompleted: task?.done ?? false })
const folder: ParsedNode = { ...base("Work", 0), nodeType: "folder", name: "Work" } as unknown as ParsedNode
const web: Browse = { type: "browse", url: "https://x.io", title: "Browse 🔗 https://x.io", icon: "", shortcut: { key: "enter", modifiers: [] } }

const key = { mode: null, via: "key", hasChildren: false, web: null } as const

describe("rowIntent: Enter in the search and in explore mode", () => {
    it("explores notes and headings, leaves included", () => {
        expect(rowIntent(page("P"), key)).toEqual({ kind: "explore" })
        expect(rowIntent(header("P", "H"), { ...key, mode: "explore" })).toEqual({ kind: "explore" })
    })

    it("explores a line with children, even a task", () => {
        expect(rowIntent(line([plain("goal")], { done: false }), { ...key, hasChildren: true })).toEqual({ kind: "explore" })
    })

    it("opens a line's web URL before anything else", () => {
        expect(rowIntent(line([plain("spec")]), { ...key, hasChildren: true, web })).toEqual({ kind: "browse", action: web })
    })

    it("toggles a leaf task: done when open, not done when completed", () => {
        expect(rowIntent(line([plain("buy")], { done: false }), key)).toEqual({ kind: "toggleTask", done: true })
        expect(rowIntent(line([plain("buy")], { done: true }), key)).toEqual({ kind: "toggleTask", done: false })
    })

    it("copies a leaf line's first snippet", () => {
        expect(rowIntent(line([plain("run "), code("bun test"), code("x")]), key)).toEqual({ kind: "copy", text: "bun test" })
    })

    it("edits a plain leaf line", () => {
        expect(rowIntent(line([plain("note to self")]), key)).toEqual({ kind: "edit" })
    })

    it("leaves other rows to their default action", () => {
        expect(rowIntent(folder, key)).toEqual({ kind: "default" })
    })
})

describe("rowIntent: a click on the selected row", () => {
    const click = { ...key, via: "pointer" } as const

    it("explores any note, heading or line, leaf tasks, snippets and URLs included", () => {
        expect(rowIntent(line([plain("buy")], { done: false }), click)).toEqual({ kind: "explore" })
        expect(rowIntent(line([code("bun test")]), click)).toEqual({ kind: "explore" })
        expect(rowIntent(line([plain("spec")]), { ...click, web })).toEqual({ kind: "explore" })
        expect(rowIntent(page("P"), click)).toEqual({ kind: "explore" })
    })
})

describe("rowIntent: edit mode", () => {
    it("edits notes, headings and lines whatever they hold", () => {
        expect(rowIntent(line([plain("buy")], { done: false }), { ...key, mode: "edit", web })).toEqual({ kind: "edit" })
        expect(rowIntent(page("P"), { ...key, mode: "edit", via: "pointer" })).toEqual({ kind: "edit" })
    })
})

describe("snippetOf", () => {
    it("is the first code span, trimmed; null without one", () => {
        expect(snippetOf(line([plain("a"), code(" ls -la ")]))).toBe("ls -la")
        expect(snippetOf(line([plain("a")]))).toBeNull()
        expect(snippetOf(page("P"))).toBeNull()
    })
})
