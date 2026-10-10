import { describe, it, expect } from "bun:test"
import { appendOutlineEmpty, editorHints, NAMES_HINT, renameFileHints } from "../edit/editor-hints.ts"

const base = {
  mode: "append" as const,
  parentName: "Project X",
  contents: {},
  contentOrder: [],
  noteExists: () => false,
}

describe("appendOutlineEmpty", () => {
  it("treats no bullets and the untouched prefilled parent as empty", () => {
    expect(appendOutlineEmpty("- ")).toBe(true)
    expect(appendOutlineEmpty("- [[Project X]]\n    - ", "Project X")).toBe(true)
  })

  it("treats a parent with children or a lone non-parent link as content", () => {
    expect(appendOutlineEmpty("- [[Project X]]\n    - [[A]]", "Project X")).toBe(false)
    expect(appendOutlineEmpty("- [[Meeting]]")).toBe(false)
  })

  it("treats a parent root carrying an alias or field as content", () => {
    expect(appendOutlineEmpty("- [[P|a]]", "P")).toBe(false)
    expect(appendOutlineEmpty("- [[P]] (is:: x)", "P")).toBe(false)
    expect(appendOutlineEmpty("- [[P]]\n    - ", "P")).toBe(true)
  })
})

describe("editorHints", () => {
  it("shows no hint for the untouched prefilled outline", () => {
    expect(editorHints({ ...base, outline: "- [[Project X]]\n    - " })).toEqual([])
  })

  it("blocks headings in an append outline", () => {
    const hints = editorHints({ ...base, outline: "- ## Decisions" })
    expect(hints[0]).toEqual({ text: "Headings go in a note's content — click [[Project X]]", blocking: true })
  })

  it("points headings at any link when the editor has no parent", () => {
    expect(editorHints({ ...base, parentName: "", outline: "- ## D" })[0].text).toBe("Headings go in a note's content — click a [[link]]")
  })

  it("announces a new note for a link with a buffer and no file", () => {
    const hints = editorHints({ ...base, outline: "- [[New]] kickoff", contents: { New: "Hello" }, contentOrder: ["New"] })
    expect(hints).toEqual([{ text: 'Creates note "New"', blocking: false }])
  })

  it("describes note patches instead of dangling-link hints for patched names", () => {
    const patches = [{ name: "New", aliases: ["n"], headings: [], fields: [] }]
    const texts = editorHints({ ...base, outline: "- [[Project X]]\n    - [[New|n]]", patches }).map(h => h.text)
    expect(texts).toContain('Creates note "New"')
    expect(texts).toContain('Adds alias "n" to New')
    expect(texts.some(t => t.includes("stays a link"))).toBe(false)
  })

  it("distinguishes appending, dangling links and plain bullets", () => {
    const hints = editorHints({
      ...base,
      outline: "- [[Old]] and [[Ghost]]\n- buy milk",
      contents: { Old: "more" },
      contentOrder: ["Old"],
      noteExists: n => n === "Old",
    })
    expect(hints).toEqual([
      { text: "Plain bullets aren't indexed — they won't appear in results", blocking: false },
      { text: "Appends to Old.md", blocking: false },
      { text: "[[Ghost]] stays a link without a note — click it to add content", blocking: false },
    ])
  })

  it("blocks invalid characters in a new note name", () => {
    const hints = editorHints({ ...base, outline: "- [[A/B]]", contents: { "A/B": "text" }, contentOrder: ["A/B"] })
    expect(hints[0]).toEqual({ text: 'Names can\'t contain \\ / : * ? " < > |', blocking: true })
  })

  it("emits the names hint once when an attachment name is also invalid", () => {
    const hints = editorHints({
      ...base,
      outline: "- [[A/B]]",
      contents: { "A/B": "text" },
      contentOrder: ["A/B"],
      attachmentError: { invalidName: "a:b.png" },
    })
    expect(hints.filter(h => h.blocking)).toEqual([{ text: 'Names can\'t contain \\ / : * ? " < > |', blocking: true }])
  })

  it("blocks an empty edit line and a heading-looking edit", () => {
    expect(editorHints({ ...base, mode: "edit", editKind: "list", outline: "  " })[0]).toEqual({
      text: "Empty — use Archive to remove the line",
      blocking: true,
    })
    expect(editorHints({ ...base, mode: "edit", editKind: "list", outline: "## H" })[0].blocking).toBe(true)
  })

  it("flags a plain edit line only when it is not a task", () => {
    const plain = "Plain bullets aren't indexed — they won't appear in results"
    const texts = (linePrefix: string) =>
      editorHints({ ...base, mode: "edit", editKind: "list", outline: "buy milk", linePrefix }).map(h => h.text)
    expect(texts("- [ ] ")).not.toContain(plain)
    expect(texts("- ")).toContain(plain)
  })

  it("drops the plain-bullet hint when Save dates every line (append under a picked line)", () => {
    const plain = "Plain bullets aren't indexed — they won't appear in results"
    expect(editorHints({ ...base, outline: "- buy milk" }).map(h => h.text)).toContain(plain)
    expect(editorHints({ ...base, outline: "- buy milk", datedLines: true }).map(h => h.text)).not.toContain(plain)
  })

  it("reports an ambiguous attachment", () => {
    const hints = editorHints({ ...base, outline: "- [[P]]", attachmentError: { ambiguous: "x.png" } })
    expect(hints[0]).toEqual({
      text: "Can't tell which attachment ![[x.png]] is — restore its file name and change the alias instead",
      blocking: true,
    })
  })
})

describe("renameFileHints", () => {
  const exists = (name: string) => ["photo.png", "taken.png"].includes(name.toLowerCase())
  const hints = (stem: string) => renameFileHints(stem, "photo.png", "png", exists)

  it("blocks an empty name, invalid characters and another existing file", () => {
    expect(hints("  ")).toEqual([{ text: "Name the file", blocking: true }])
    expect(hints("a/b")).toEqual([{ text: NAMES_HINT, blocking: true }])
    expect(hints("Taken")).toEqual([{ text: '"Taken.png" already exists', blocking: true }])
  })

  it("allows a new name and a case-only change of the same file", () => {
    expect(hints("cover")).toEqual([])
    expect(hints("Photo")).toEqual([])
  })
})
