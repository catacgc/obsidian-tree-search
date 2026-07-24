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
