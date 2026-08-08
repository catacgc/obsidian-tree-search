import { describe, it, expect } from "bun:test"
import { suggestAt, spliceSuggestion } from "../search/suggest.ts"

describe("suggestAt", () => {
  it("suggests all is: values when just the field prefix is typed", () => {
    expect(suggestAt("is:", 3)).toEqual([
      { label: "is:page", insertText: "is:page" },
      { label: "is:header", insertText: "is:header" },
      { label: "is:text", insertText: "is:text" },
      { label: "is:folder", insertText: "is:folder" },
      { label: "is:attachment", insertText: "is:attachment" },
      { label: "is:task", insertText: "is:task" },
      { label: "is:completed", insertText: "is:completed" },
      { label: "is:undated", insertText: "is:undated" },
      { label: "is:archived", insertText: "is:archived" },
    ])
  })

  it("narrows to a single match for an unambiguous prefix", () => {
    expect(suggestAt("is:p", 4)).toEqual([{ label: "is:page", insertText: "is:page" }])
  })

  it("shows multiple candidates for an ambiguous prefix", () => {
    expect(suggestAt("is:t", 4)).toEqual([
      { label: "is:text", insertText: "is:text" },
      { label: "is:task", insertText: "is:task" },
    ])
  })

  it("suggests has: values matching a prefix", () => {
    expect(suggestAt("has:e", 5)).toEqual([{ label: "has:emoji", insertText: "has:emoji" }])
  })

  it("returns nothing once the value is already an exact, complete match", () => {
    expect(suggestAt("is:page", 7)).toEqual([])
  })

  it("returns nothing for plain text with no complete field prefix", () => {
    expect(suggestAt("meeting notes", 7)).toEqual([])
    expect(suggestAt("is", 2)).toEqual([])
    expect(suggestAt("ha", 2)).toEqual([])
  })

  it("only considers the token immediately before the cursor, not the whole query", () => {
    expect(suggestAt("meeting is:p", 12)).toEqual([{ label: "is:page", insertText: "is:page" }])
  })

  it("offers canonical duration presets for a bare in: prefix", () => {
    expect(suggestAt("in:", 3)).toEqual([
      { label: "in:7d", insertText: "in:7d" },
      { label: "in:1m", insertText: "in:1m" },
      { label: "in:1y", insertText: "in:1y" },
    ])
  })

  it("completes a typed in: number with every unit", () => {
    expect(suggestAt("in:2", 4)).toEqual([
      { label: "in:2d", insertText: "in:2d" },
      { label: "in:2w", insertText: "in:2w" },
      { label: "in:2m", insertText: "in:2m" },
      { label: "in:2y", insertText: "in:2y" },
    ])
  })

  it("narrows in: unit completions to a partially-typed unit letter", () => {
    expect(suggestAt("in:3d", 5)).toEqual([]) // already complete
    expect(suggestAt("in:1", 4)).toContainEqual({ label: "in:1w", insertText: "in:1w" })
  })

  it("returns nothing for an in: token with a mixed number/unit shape", () => {
    expect(suggestAt("in:2d3", 6)).toEqual([])
  })
})

describe("spliceSuggestion", () => {
  it("replaces the current token with the suggestion's insertText", () => {
    expect(spliceSuggestion("is:p", 4, "is:page")).toEqual({ query: "is:page", cursorPos: 7 })
  })

  it("preserves text before and after the current token", () => {
    expect(spliceSuggestion("meeting is:p urgent", 12, "is:page")).toEqual({
      query: "meeting is:page urgent",
      cursorPos: 15,
    })
  })
})
