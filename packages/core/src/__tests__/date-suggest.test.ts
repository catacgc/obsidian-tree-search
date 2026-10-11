import { describe, it, expect } from "bun:test"
import { applyDateSuggestion, dateSuggestAt, isDateSuggestion } from "../edit/date-suggest.ts"

const NOW = new Date(2026, 9, 8, 15, 0) // Thu 8 Oct 2026
const at = (text: string, linePrefix = "") => dateSuggestAt(text, text.length, NOW, linePrefix)

describe("dateSuggestAt", () => {
  it("lists every choice for a bare @ on an open task line, with dates", () => {
    expect(at("- [ ] call Bob @").map(s => [s.label, s.detail, s.insertText])).toEqual([
      ["Today", "Thu 8 Oct", "[scheduled:: 2026-10-08]"],
      ["Tomorrow", "Fri 9 Oct", "[scheduled:: 2026-10-09]"],
      ["Weekend", "Sat 10 Oct", "[scheduled:: 2026-10-10]"],
      ["Later", "Tue 13 Oct", "[scheduled:: 2026-10-13]"],
    ])
  })

  it("filters by the typed prefix, case-insensitively, and keeps a complete word", () => {
    expect(at("- [ ] x @T").map(s => s.label)).toEqual(["Today", "Tomorrow"])
    expect(at("- [ ] x @tom").map(s => s.label)).toEqual(["Tomorrow"])
    expect(at("- [ ] x @later").map(s => s.label)).toEqual(["Later"])
    expect(at("- [ ] x @soon")).toEqual([])
  })

  it("gives the @word's range", () => {
    const [s] = at("- [ ] x @we")
    expect([s.start, s.end]).toEqual([8, 11])
  })

  it("needs an open task line: marker optional, any indent; not done tasks or plain lines", () => {
    expect(at("    * [ ] x @t")).not.toEqual([])
    expect(at("[ ] x @t")).not.toEqual([])
    expect(at("- [x] x @t")).toEqual([])
    expect(at("- note @t")).toEqual([])
  })

  it("uses linePrefix for a field holding only the line's text (Alt-Edit)", () => {
    expect(at("call @t", "- [ ] ")).not.toEqual([])
    expect(at("call @t", "- ")).toEqual([])
  })

  it("ignores @ inside a word and a caret before the word's end", () => {
    expect(at("- [ ] mail a@t")).toEqual([])
    expect(dateSuggestAt("- [ ] x @tod", 10, NOW)).toEqual([])
  })

  it("reads the caret's line of a multi-line text", () => {
    const text = "- [[P]]\n    - [ ] x @t\n- y"
    const [s] = dateSuggestAt(text, text.indexOf("\n- y"), NOW)
    expect(text.slice(s.start, s.end)).toBe("@t")
  })

  it("marks its suggestions as date suggestions", () => {
    expect(isDateSuggestion(at("- [ ] x @")[0])).toBe(true)
    expect(isDateSuggestion({ label: "is:task", insertText: "is:task" })).toBe(false)
  })
})

describe("applyDateSuggestion", () => {
  it("replaces the @word and puts the caret after the field", () => {
    const text = "- [ ] call @tom about it"
    const s = dateSuggestAt(text, 15, NOW)[0]
    expect(applyDateSuggestion(text, s)).toEqual({ text: "- [ ] call [scheduled:: 2026-10-09] about it", caret: 35 })
  })

  it("drops other scheduled fields on that line only", () => {
    const text = "- [ ] a [scheduled:: 2026-01-01]\n- [ ] b ⏳ 2026-01-02 @la (scheduled:: 2026-01-03)"
    const s = dateSuggestAt(text, text.indexOf(" (scheduled"), NOW)[0]
    expect(applyDateSuggestion(text, s).text)
      .toBe("- [ ] a [scheduled:: 2026-01-01]\n- [ ] b [scheduled:: 2026-10-13]")
  })
})
