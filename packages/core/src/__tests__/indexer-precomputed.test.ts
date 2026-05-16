import { describe, it, expect } from "bun:test"
import { NotesGraph } from "../graph/graph.ts"
import { indexSinglePage, DEFAULT_SETTINGS } from "../graph/indexer.ts"
import { parseVaultFile } from "../parser/vault-file.ts"
import { parseTokens } from "../parser/inline-tokens.ts"
import type { DvPage, ParsedTextToken } from "../graph/types.ts"

const MTIME = 1_700_000_000_000

function parse(content: string, path = "note.md") {
  return parseVaultFile(content, path, MTIME)
}

describe("precomputedTokens usage in indexSinglePage", () => {
  it("precomputedTokens is used when present (takes precedence over rawText)", () => {
    const page = parse("- [[Bar]] ignored", "note.md")
    // Override precomputedTokens to point to Foo instead of Bar
    const fooTokens: ParsedTextToken[] = [
      { tokenType: "obsidian_link", source: "[[Foo]]", pageTarget: "Foo" },
    ]
    page.file.lists.values[0].precomputedTokens = fooTokens

    const g = new NotesGraph()
    indexSinglePage(page, g, DEFAULT_SETTINGS)

    // Should see Foo (from precomputed), not Bar (from rawText)
    expect(g.hasNode("[[foo]]")).toBe(true)
    expect(g.hasNode("[[bar]]")).toBe(false)
  })

  it("precomputedTokens undefined falls back to parseTokensFn (default)", () => {
    const page = parse("- [[Bar]] text", "note.md")
    // precomputedTokens is not set (undefined) — should parse rawText normally
    expect(page.file.lists.values[0].precomputedTokens).toBeUndefined()

    const g = new NotesGraph()
    indexSinglePage(page, g, DEFAULT_SETTINGS)

    expect(g.hasNode("[[bar]]")).toBe(true)
  })

  it("precomputedParentTokens is used when present", () => {
    const page = parse("---\nparent: \"[[Root]]\"\n---\n\n- [[A]] text", "child.md")
    // Override precomputedParentTokens to point to CustomRoot instead of Root
    page.precomputedParentTokens = new Map([
      ["[[Root]]", [{ tokenType: "obsidian_link", source: "[[CustomRoot]]", pageTarget: "CustomRoot" } as ParsedTextToken]],
    ])

    const g = new NotesGraph()
    indexSinglePage(page, g, DEFAULT_SETTINGS)

    // Should see CustomRoot (from precomputed), not Root
    expect(g.hasNode("[[customroot]]")).toBe(true)
    expect(g.hasEdge("[[customroot]]", "[[child]]")).toBe(true)
    // Root should NOT be present
    expect(g.hasNode("[[root]]")).toBe(false)
  })

  it("precomputedParentTokens undefined falls back to parseTokensFn", () => {
    const page = parse("---\nparent: \"[[Root]]\"\n---\n\n- [[A]] text", "child.md")
    expect(page.precomputedParentTokens).toBeUndefined()

    const g = new NotesGraph()
    indexSinglePage(page, g, DEFAULT_SETTINGS)

    // Should parse "[[Root]]" normally
    expect(g.hasNode("[[root]]")).toBe(true)
    expect(g.hasEdge("[[root]]", "[[child]]")).toBe(true)
  })

  it("custom parseTokensFn is called when no precomputedTokens", () => {
    const page = parse("- [[A]] text\n- [[B]] more", "note.md")
    expect(page.file.lists.values[0].precomputedTokens).toBeUndefined()

    let callCount = 0
    const trackingFn = (text: string): ParsedTextToken[] => {
      callCount++
      return parseTokens(text)
    }

    const g = new NotesGraph()
    indexSinglePage(page, g, DEFAULT_SETTINGS, trackingFn)

    // Should have been called for each non-skipped list item
    expect(callCount).toBeGreaterThan(0)
    // Two list items, both have links so won't be skipped
    expect(callCount).toBe(2)
  })

  it("custom parseTokensFn is NOT called when precomputedTokens present", () => {
    const page = parse("- [[A]] text", "note.md")
    // Set precomputedTokens
    page.file.lists.values[0].precomputedTokens = parseTokens(page.file.lists.values[0].rawText)

    let callCount = 0
    const trackingFn = (text: string): ParsedTextToken[] => {
      callCount++
      return parseTokens(text)
    }

    const g = new NotesGraph()
    indexSinglePage(page, g, DEFAULT_SETTINGS, trackingFn)

    // parseTokensFn should NOT have been called for the list item's rawText
    // It may be called for frontmatter parent strings though - there are none in this case
    expect(callCount).toBe(0)
  })
})
