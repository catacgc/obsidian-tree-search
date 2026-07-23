import { describe, it, expect } from "bun:test"
import { parseQuery, matchQuery, firstPassInclude, type QueryExpr } from "../search/query.ts"
import type { ParsedNode } from "../graph/types.ts"

const baseLocation = { path: "test.md", position: { start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } } }

function page(searchKey: string): ParsedNode {
  return {
    nodeType: "page", searchKey, location: baseLocation, boost: 0, ageDays: 0,
    isReference: false, page: searchKey, aliases: [], tags: [],
  }
}

function header(searchKey: string): ParsedNode {
  return {
    nodeType: "header", searchKey, location: baseLocation, boost: 0, ageDays: 0,
    page: "page", header: searchKey, indent: 1,
  }
}

function text(searchKey: string, opts: { isTask?: boolean; isCompleted?: boolean; hasLink?: boolean } = {}): ParsedNode {
  return {
    nodeType: "text", searchKey, location: baseLocation, boost: 0, ageDays: 0,
    parsedTokens: opts.hasLink
      ? [{ tokenType: "obsidian_link", source: searchKey, pageTarget: searchKey }]
      : [{ tokenType: "text", text: searchKey, decoration: "none" }],
    tags: [], isTask: opts.isTask ?? false, isCompleted: opts.isCompleted ?? false,
  }
}

describe("parseQuery / tokenizer", () => {
  it("splits stages on the separator character", () => {
    const stages = parseQuery("foo.bar", ".")
    expect(stages).toHaveLength(2)
    expect(stages[0]).toEqual({ type: "contains", value: "foo" })
    expect(stages[1]).toEqual({ type: "contains", value: "bar" })
  })

  it("respects a custom separator character", () => {
    const stages = parseQuery("foo/bar", "/")
    expect(stages).toHaveLength(2)
    expect(stages[0]).toEqual({ type: "contains", value: "foo" })
    expect(stages[1]).toEqual({ type: "contains", value: "bar" })
  })

  it("keeps a literal separator inside quotes as one stage", () => {
    const stages = parseQuery('"3.5"', ".")
    expect(stages).toHaveLength(1)
    expect(stages[0]).toEqual({ type: "equals", value: "3.5" })
  })

  it("keeps a hyphen inside a word literal (not negation)", () => {
    const stages = parseQuery("well-known", ".")
    expect(stages[0]).toEqual({ type: "contains", value: "well-known" })
  })

  it("parses a leading minus as negation", () => {
    const stages = parseQuery("-low", ".")
    expect(stages[0]).toEqual({ type: "not", expr: { type: "contains", value: "low" } })
  })

  it("parses is:/has: fields as modifiers", () => {
    expect(parseQuery("is:page", ".")[0]).toEqual({ type: "modifier", field: "is", value: "page" })
    expect(parseQuery("has:emoji", ".")[0]).toEqual({ type: "modifier", field: "has", value: "emoji" })
  })

  it("negates a modifier", () => {
    expect(parseQuery("-is:text", ".")[0]).toEqual({
      type: "not",
      expr: { type: "modifier", field: "is", value: "text" },
    })
  })

  it("parses OR groups", () => {
    expect(parseQuery("a | b", ".")[0]).toEqual({
      type: "or",
      exprs: [{ type: "contains", value: "a" }, { type: "contains", value: "b" }],
    })
  })

  it("groups with parentheses and negates the group", () => {
    expect(parseQuery("-(a | b)", ".")[0]).toEqual({
      type: "not",
      expr: { type: "or", exprs: [{ type: "contains", value: "a" }, { type: "contains", value: "b" }] },
    })
  })

  it("combines a parenthesized group with an AND term", () => {
    expect(parseQuery("(a | b) -is:text", ".")[0]).toEqual({
      type: "and",
      exprs: [
        { type: "or", exprs: [{ type: "contains", value: "a" }, { type: "contains", value: "b" }] },
        { type: "not", expr: { type: "modifier", field: "is", value: "text" } },
      ],
    })
  })

  it("does not throw on an unclosed parenthesis", () => {
    expect(() => parseQuery("(a", ".")).not.toThrow()
  })

  it("does not split into stages inside parentheses", () => {
    expect(parseQuery("(a.b)", ".")).toHaveLength(1)
    expect(parseQuery("(a.b)", ".")[0]).toEqual({
      type: "and",
      exprs: [{ type: "contains", value: "a" }, { type: "contains", value: "b" }],
    })
  })

  it("negates a whole parenthesized group even when it contains a separator char", () => {
    const stages = parseQuery("-(a.b)", ".")
    expect(stages).toHaveLength(1)
    expect(stages[0]).toEqual({
      type: "not",
      expr: { type: "and", exprs: [{ type: "contains", value: "a" }, { type: "contains", value: "b" }] },
    })
  })

  it("ignores empty branches from a doubled or trailing pipe instead of matching everything", () => {
    expect(parseQuery("a || b", ".")[0]).toEqual({
      type: "or",
      exprs: [{ type: "contains", value: "a" }, { type: "contains", value: "b" }],
    })
    expect(parseQuery("a |", ".")[0]).toEqual({ type: "contains", value: "a" })
  })
})

describe("matchQuery", () => {
  it("is:page matches only page nodes", () => {
    const expr: QueryExpr = { type: "modifier", field: "is", value: "page" }
    expect(matchQuery(page("home"), expr)).toBe(true)
    expect(matchQuery(header("overview"), expr)).toBe(false)
    expect(matchQuery(text("hello"), expr)).toBe(false)
  })

  it("is:text matches only text nodes", () => {
    const expr: QueryExpr = { type: "modifier", field: "is", value: "text" }
    expect(matchQuery(text("hello"), expr)).toBe(true)
    expect(matchQuery(page("home"), expr)).toBe(false)
  })

  it("is:task matches only task-flagged text nodes", () => {
    const expr: QueryExpr = { type: "modifier", field: "is", value: "task" }
    expect(matchQuery(text("buy milk", { isTask: true }), expr)).toBe(true)
    expect(matchQuery(text("buy milk"), expr)).toBe(false)
  })

  it("has:emoji matches nodes whose search key contains an emoji", () => {
    const expr: QueryExpr = { type: "modifier", field: "has", value: "emoji" }
    expect(matchQuery(text("🎉 party"), expr)).toBe(true)
    expect(matchQuery(text("party"), expr)).toBe(false)
  })

  it("has:link matches text nodes containing a wikilink", () => {
    const expr: QueryExpr = { type: "modifier", field: "has", value: "link" }
    expect(matchQuery(text("see [[foo]]", { hasLink: true }), expr)).toBe(true)
    expect(matchQuery(text("plain text"), expr)).toBe(false)
  })

  it("an unknown field value never matches", () => {
    const expr: QueryExpr = { type: "modifier", field: "is", value: "bogus" }
    expect(matchQuery(page("home"), expr)).toBe(false)
  })

  it("negation inverts any expression, including a modifier", () => {
    const expr: QueryExpr = { type: "not", expr: { type: "modifier", field: "is", value: "text" } }
    expect(matchQuery(page("home"), expr)).toBe(true)
    expect(matchQuery(text("hello"), expr)).toBe(false)
  })
})

describe("firstPassInclude", () => {
  it("matches non-negated expressions directly", () => {
    const expr: QueryExpr = { type: "contains", value: "home" }
    expect(firstPassInclude(page("home"), expr)).toBe(true)
    expect(firstPassInclude(page("other"), expr)).toBe(false)
  })

  it("inverts a top-level negation", () => {
    const expr: QueryExpr = { type: "not", expr: { type: "modifier", field: "is", value: "text" } }
    expect(firstPassInclude(page("home"), expr)).toBe(true)
    expect(firstPassInclude(text("hello"), expr)).toBe(false)
  })
})
