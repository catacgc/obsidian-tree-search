import { describe, it, expect } from "bun:test"
import type { ParsedNode, TextNode } from "@mdtree/core"
import { appendPickFor, closedLinkName } from "../view/editor/append-target"

const loc = (path: string, line: number) => ({ path, position: { start: { line, ch: 0 }, end: { line, ch: 0 } } })
const base = (path: string, line: number) => ({ searchKey: "", location: loc(path, line), boost: 0, ageDays: 0 })
const page = (name: string): ParsedNode =>
    ({ ...base(`${name}.md`, 0), nodeType: "page", isReference: false, page: name, aliases: [], tags: [] })
const header = (pageName: string, h: string): ParsedNode =>
    ({ ...base(`${pageName}.md`, 3), nodeType: "header", page: pageName, header: h, indent: 1 })
const text = (key: string, path: string, line: number): TextNode =>
    ({ ...base(path, line), searchKey: key, nodeType: "text", parsedTokens: [{ tokenType: "text", text: key, decoration: "none" }], tags: [], isTask: false, isCompleted: false })
const folder = (path: string): ParsedNode =>
    ({ ...base(path, 0), nodeType: "folder", path, name: path.split("/").pop()!, folderNote: "" })

const DAILY = "2026-10-07"

describe("appendPickFor", () => {
    it("uses the selected row over an open [[query", () => {
        expect(appendPickFor(page("AEP Testing"), "[[test", DAILY)).toEqual({ kind: "link", name: "AEP Testing" })
    })

    it("targets a selected heading as P#H, a line as itself, and today's draft for the daily note", () => {
        expect(appendPickFor(header("P", "H"), "", DAILY)).toEqual({ kind: "link", name: "P#H" })
        const line = text("buy milk", "Shop.md", 4)
        expect(appendPickFor(line, "milk", DAILY)).toEqual({ kind: "line", node: line })
        expect(appendPickFor(page("2026-10-07"), "", DAILY)).toEqual({ kind: "draft" })
    })

    it("refuses rows that take no children", () => {
        expect(appendPickFor(folder("Work"), "", DAILY)).toEqual({ kind: "refuse" })
    })

    it("without a row: a closed [[name]] is the target, a blank query today's draft, anything else nothing", () => {
        expect(appendPickFor(null, "[[test", DAILY)).toEqual({ kind: "none" })
        expect(appendPickFor(null, "[[test]]", DAILY)).toEqual({ kind: "link", name: "test" })
        expect(appendPickFor(null, " [[Project X|PX]] ", DAILY)).toEqual({ kind: "link", name: "Project X" })
        expect(appendPickFor(null, "", DAILY)).toEqual({ kind: "draft" })
        expect(appendPickFor(null, "foo", DAILY)).toEqual({ kind: "none" })
    })
})

describe("closedLinkName", () => {
    it("accepts only a whole closed link", () => {
        expect(closedLinkName("[[a]] b")).toBeNull()
        expect(closedLinkName("[[ ]]")).toBeNull()
        expect(closedLinkName("[[a]]")).toBe("a")
    })
})
