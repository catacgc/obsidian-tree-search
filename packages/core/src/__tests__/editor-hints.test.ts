import { describe, it, expect } from "bun:test"
import { appendOutlineEmpty, editorHints } from "../edit/editor-hints.ts"

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

  it("reports an ambiguous attachment", () => {
    const hints = editorHints({ ...base, outline: "- [[P]]", attachmentError: { ambiguous: "x.png" } })
    expect(hints[0]).toEqual({
      text: "Can't tell which attachment ![[x.png]] is — restore its file name and change the alias instead",
      blocking: true,
    })
  })
})
