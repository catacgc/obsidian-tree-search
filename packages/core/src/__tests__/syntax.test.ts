import { describe, it, expect } from "bun:test"
import { describeQuerySyntax } from "../search/syntax.ts"
import { IS_VALUES, HAS_VALUES, parseQuery } from "../search/query.ts"

const groups = describeQuerySyntax()
const entries = groups.flatMap(g => g.entries)

describe("describeQuerySyntax drift guards", () => {
  it("describes every is: value exactly once, with a non-empty description", () => {
    for (const v of IS_VALUES) {
      const matches = entries.filter(e => e.insertText === `is:${v}`)
      expect(matches).toHaveLength(1)
      expect(matches[0].description.trim().length).toBeGreaterThan(0)
    }
  })

  it("describes every has: value exactly once, with a non-empty description", () => {
    for (const v of HAS_VALUES) {
      const matches = entries.filter(e => e.insertText === `has:${v}`)
      expect(matches).toHaveLength(1)
      expect(matches[0].description.trim().length).toBeGreaterThan(0)
    }
  })

  it("every clickable entry re-parses to a single modifier the grammar accepts", () => {
    const clickable = entries.filter(e => e.insertText)
    expect(clickable.length).toBeGreaterThan(0)
    for (const e of clickable) {
      const parsed = parseQuery(e.insertText!, ".")
      expect(parsed).toHaveLength(1)
      expect(parsed[0].type).toBe("modifier")
    }
  })

  it("grammar/free-text entries are illustrative (no insertText)", () => {
    const combine = groups.find(g => g.title === "Combine")!
    expect(combine.entries.every(e => e.insertText === undefined)).toBe(true)
  })
})
