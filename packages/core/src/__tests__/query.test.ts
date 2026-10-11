import { describe, it, expect } from "bun:test"
import { parseQuery, matchQuery, nodeMatchesQuery, parseDuration, collectModifiers, extractArchiveReveal, openLinkAt, type QueryExpr, IS_VALUES, HAS_VALUES } from "../search/query.ts"
import { UNDATED_AGE } from "../graph/boost.ts"
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

function folder(searchKey: string): ParsedNode {
  return {
    nodeType: "folder", searchKey, location: baseLocation, boost: 0, ageDays: 0,
    path: searchKey, name: searchKey, folderNote: "",
  }
}

function attachment(searchKey: string): ParsedNode {
  return {
    nodeType: "attachment", searchKey, location: baseLocation, boost: 0, ageDays: 0,
    name: searchKey, extension: "png", aliases: [],
  }
}

function text(searchKey: string, opts: { isTask?: boolean; isCompleted?: boolean; hasLink?: boolean; hasHeaderLink?: boolean; nested?: true; list?: true } = {}): ParsedNode {
  return {
    nodeType: "text", searchKey, location: baseLocation, boost: 0, ageDays: 0,
    parsedTokens: opts.hasHeaderLink
      ? [{ tokenType: "obsidian_link", source: searchKey, pageTarget: searchKey, headerName: "section" }]
      : opts.hasLink
      ? [{ tokenType: "obsidian_link", source: searchKey, pageTarget: searchKey }]
      : [{ tokenType: "text", text: searchKey, decoration: "none" }],
    tags: [], isTask: opts.isTask ?? false, isCompleted: opts.isCompleted ?? false,
    ...(opts.nested ? { nested: true } : {}),
    ...(opts.list ? { list: true } : {}),
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

  it("treats a dangling negation as a no-op instead of poisoning the query to always-false", () => {
    expect(parseQuery("foo -", ".")[0]).toEqual({
      type: "and",
      exprs: [{ type: "contains", value: "foo" }, { type: "empty" }],
    })
    expect(parseQuery("--foo", ".")[0]).toEqual({
      type: "and",
      exprs: [{ type: "empty" }, { type: "contains", value: "foo" }],
    })
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

  it("is:task matches only open (uncompleted) task-flagged text nodes", () => {
    const expr: QueryExpr = { type: "modifier", field: "is", value: "task" }
    expect(matchQuery(text("buy milk", { isTask: true }), expr)).toBe(true)
    expect(matchQuery(text("buy milk", { isTask: true, isCompleted: true }), expr)).toBe(false)
    expect(matchQuery(text("buy milk"), expr)).toBe(false)
  })

  it("is:subtask / is:subtext / is:list narrow by nesting", () => {
    const is = (value: string): QueryExpr => ({ type: "modifier", field: "is", value })
    const sub = text("call", { isTask: true, nested: true })
    const note = text("note", { nested: true })
    const top = text("top", { isTask: true, list: true })
    const doneSub = text("done", { isTask: true, isCompleted: true, nested: true })
    expect([sub, note, top, doneSub].map(n => matchQuery(n, is("subtask")))).toEqual([true, false, false, false])
    expect([sub, note, top, doneSub].map(n => matchQuery(n, is("subtext")))).toEqual([false, true, false, false])
    expect([sub, note, top, doneSub].map(n => matchQuery(n, is("list")))).toEqual([false, false, true, false])
    expect(matchQuery(sub, is("task"))).toBe(true)
  })

  it("is:completed matches only completed task-flagged text nodes", () => {
    const expr: QueryExpr = { type: "modifier", field: "is", value: "completed" }
    expect(matchQuery(text("buy milk", { isTask: true, isCompleted: true }), expr)).toBe(true)
    expect(matchQuery(text("buy milk", { isTask: true }), expr)).toBe(false)
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

  it("has:page matches a page-level wikilink but not a header-targeted one", () => {
    const expr: QueryExpr = { type: "modifier", field: "has", value: "page" }
    expect(matchQuery(text("see [[foo]]", { hasLink: true }), expr)).toBe(true)
    expect(matchQuery(text("see [[foo#bar]]", { hasHeaderLink: true }), expr)).toBe(false)
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

  it("every IS_VALUES/HAS_VALUES entry is a real, matchable modifier (catches drift from matchModifier's switch)", () => {
    for (const value of IS_VALUES) {
      const expr: QueryExpr = { type: "modifier", field: "is", value }
      const matchesSomething =
        matchQuery(page("x"), expr) || matchQuery(header("x"), expr) ||
        matchQuery(text("x", { isTask: true }), expr) || matchQuery(text("x"), expr) ||
        matchQuery(text("x", { isTask: true, nested: true }), expr) || matchQuery(text("x", { nested: true }), expr) ||
        matchQuery(text("x", { list: true }), expr) ||
        matchQuery(text("x", { isTask: true, isCompleted: true }), expr) ||
        matchQuery(folder("x"), expr) || matchQuery(attachment("x"), expr) ||
        matchQuery({ ...page("x"), ageDays: UNDATED_AGE }, expr) ||
        matchQuery({ ...text("x"), archived: true }, expr)
      expect(matchesSomething).toBe(true)
    }
    for (const value of HAS_VALUES) {
      const expr: QueryExpr = { type: "modifier", field: "has", value }
      const matchesSomething =
        matchQuery(text("has emoji 🎉"), expr) ||
        matchQuery(text("has link", { hasLink: true }), expr)
      expect(matchesSomething).toBe(true)
    }
  })
})

describe("nodeMatchesQuery", () => {
  it("treats an empty query as matching everything (nothing dimmed)", () => {
    expect(nodeMatchesQuery(text("anything"), [])).toBe(true)
  })

  it("matches when the node satisfies any query stage", () => {
    const stages = parseQuery("foo.bar", ".")
    expect(nodeMatchesQuery(text("foo line"), stages)).toBe(true)   // matches stage foo
    expect(nodeMatchesQuery(text("bar line"), stages)).toBe(true)   // matches stage bar
    expect(nodeMatchesQuery(text("unrelated"), stages)).toBe(false) // context only
  })

  it("honors is:/has: field semantics within a stage", () => {
    const stages = parseQuery("is:page", ".")
    expect(nodeMatchesQuery(page("home"), stages)).toBe(true)
    expect(nodeMatchesQuery(text("home"), stages)).toBe(false)
  })
})

describe("parseDuration", () => {
  it("converts short and long unit forms to whole days", () => {
    expect(parseDuration("7d")).toBe(7)
    expect(parseDuration("7days")).toBe(7)
    expect(parseDuration("2w")).toBe(14)
    expect(parseDuration("1m")).toBe(30)
    expect(parseDuration("1month")).toBe(30)
    expect(parseDuration("1y")).toBe(365)
    expect(parseDuration("1year")).toBe(365)
    expect(parseDuration("30d")).toBe(30)
  })

  it("rejects malformed, zero, or unknown-unit durations", () => {
    expect(parseDuration("abc")).toBeNull()
    expect(parseDuration("7")).toBeNull()
    expect(parseDuration("d")).toBeNull()
    expect(parseDuration("0d")).toBeNull()
    expect(parseDuration("7x")).toBeNull()
    expect(parseDuration("")).toBeNull()
  })
})

describe("in: recency modifier", () => {
  it("parses in:<duration> as an in modifier, keeping the raw value", () => {
    expect(parseQuery("in:7d", ".")[0]).toEqual({ type: "modifier", field: "in", value: "7d" })
    expect(parseQuery("in:1month", ".")[0]).toEqual({ type: "modifier", field: "in", value: "1month" })
  })

  it("matches nodes at or within the window and rejects older ones", () => {
    const expr: QueryExpr = { type: "modifier", field: "in", value: "7d" }
    expect(matchQuery({ ...text("recent"), ageDays: 3 }, expr)).toBe(true)
    expect(matchQuery({ ...text("boundary"), ageDays: 7 }, expr)).toBe(true) // inclusive
    expect(matchQuery({ ...text("stale"), ageDays: 30 }, expr)).toBe(false)
  })

  it("applies the window to emoji-bearing nodes like any other", () => {
    const expr: QueryExpr = { type: "modifier", field: "in", value: "7d" }
    expect(matchQuery({ ...text("🎉 launched"), ageDays: 3 }, expr)).toBe(true)
    expect(matchQuery({ ...text("🎉 launched"), ageDays: 999 }, expr)).toBe(false)
  })

  it("never matches an invalid duration", () => {
    const expr: QueryExpr = { type: "modifier", field: "in", value: "abc" }
    expect(matchQuery({ ...text("recent"), ageDays: 0 }, expr)).toBe(false)
  })

  it("never matches an undated node in any window", () => {
    expect(matchQuery({ ...text("undated"), ageDays: UNDATED_AGE }, { type: "modifier", field: "in", value: "1y" })).toBe(false)
    expect(matchQuery({ ...text("🎉 undated"), ageDays: UNDATED_AGE }, { type: "modifier", field: "in", value: "1y" })).toBe(false)
  })
})

describe("is:undated modifier", () => {
  const expr: QueryExpr = { type: "modifier", field: "is", value: "undated" }

  it("matches only nodes with the undated sentinel age", () => {
    expect(matchQuery({ ...text("undated"), ageDays: UNDATED_AGE }, expr)).toBe(true)
    expect(matchQuery({ ...text("dated"), ageDays: 0 }, expr)).toBe(false)
    expect(matchQuery({ ...text("old but dated"), ageDays: 5000 }, expr)).toBe(false)
  })
})

describe("collectModifiers", () => {
  const inMods = (query: string) => parseQuery(query, ".").flatMap(e => collectModifiers(e, "in"))

  it("collects a lone in: modifier", () => {
    expect(inMods("in:3m")).toEqual([{ type: "modifier", field: "in", value: "3m" }])
  })

  it("collects an in: modifier nested under AND / OR", () => {
    expect(inMods("foo in:3m")).toEqual([{ type: "modifier", field: "in", value: "3m" }])
    expect(inMods("a | in:1y")).toEqual([{ type: "modifier", field: "in", value: "1y" }])
  })

  it("collects in: modifiers across stages", () => {
    expect(inMods("in:3m.bar in:1y")).toEqual([
      { type: "modifier", field: "in", value: "3m" },
      { type: "modifier", field: "in", value: "1y" },
    ])
  })

  it("ignores negated in:, other fields, and plain text", () => {
    expect(inMods("-in:3m")).toEqual([])
    expect(inMods("is:page")).toEqual([])
    expect(inMods("has:emoji")).toEqual([])
    expect(inMods("just text")).toEqual([])
  })

  it("collects a different field when asked", () => {
    expect(parseQuery("is:page in:3m", ".").flatMap(e => collectModifiers(e, "is"))).toEqual([
      { type: "modifier", field: "is", value: "page" },
    ])
  })
})

describe("prefix matching for is:/has: values", () => {
  it("resolves has:e to has:emoji (unique prefix)", () => {
    expect(parseQuery("has:e", ".")[0]).toEqual({ type: "modifier", field: "has", value: "emoji" })
  })

  it("resolves is:p to is:page (unique prefix)", () => {
    expect(parseQuery("is:p", ".")[0]).toEqual({ type: "modifier", field: "is", value: "page" })
  })

  it("leaves is:t unresolved (ambiguous between task and text) so it matches nothing", () => {
    const expr = parseQuery("is:t", ".")[0]
    expect(expr).toEqual({ type: "modifier", field: "is", value: "t" })
    expect(matchQuery(page("home"), expr)).toBe(false)
    expect(matchQuery(text("hello"), expr)).toBe(false)
  })

  it("an exact full value still resolves even though prefix-matching alone would find it too", () => {
    expect(parseQuery("is:page", ".")[0]).toEqual({ type: "modifier", field: "is", value: "page" })
  })
})

describe("outline: field", () => {
  it("keeps a quoted name whole and exact, separator and spaces included", () => {
    expect(parseQuery("outline:\"Daily 2026.10.03\" is:page", ".")).toEqual([{
      type: "and",
      exprs: [
        { type: "modifier", field: "outline", value: "daily 2026.10.03", exact: true },
        { type: "modifier", field: "is", value: "page" },
      ],
    }])
  })

  it("leaves a bare name a fragment", () => {
    expect(parseQuery("outline:sep", ".")[0]).toEqual({ type: "modifier", field: "outline", value: "sep" })
  })

  it('outline:":daily" targets the runtime\'s daily note exactly', () => {
    expect(parseQuery('outline:":daily"', ".")[0]).toEqual({ type: "modifier", field: "outline", value: ":daily", exact: true })
  })

  it("treats :name as plain text", () => {
    expect(parseQuery(":page", ".")[0]).toEqual({ type: "contains", value: ":page" })
  })
})

describe("[[note]] scope", () => {
  it("keeps a link's name whole and exact, separator and spaces included", () => {
    expect(parseQuery("[[Daily 2026.10.03]] is:page", ".")).toEqual([{
      type: "and",
      exprs: [
        { type: "modifier", field: "tree", value: "daily 2026.10.03", exact: true },
        { type: "modifier", field: "is", value: "page" },
      ],
    }])
  })

  it("drops a link's alias", () => {
    expect(parseQuery("[[Project X|PX]]", ".")[0]).toEqual({ type: "modifier", field: "tree", value: "project x", exact: true })
  })

  it("no longer reads tree: as an operator", () => {
    expect(parseQuery("tree:sep", ".")[0]).toEqual({ type: "contains", value: "tree:sep" })
  })

  it("parses an open [[fragment as its words", () => {
    expect(parseQuery("[[aep test", ".")).toEqual(parseQuery("aep test", "."))
  })

  it("skips an empty link", () => {
    expect(parseQuery("[[]] foo", ".")[0]).toEqual({ type: "contains", value: "foo" })
  })
})

describe("openLinkAt", () => {
  it("finds the last [[ with no ]] after it", () => {
    expect(openLinkAt("[[aep test")).toEqual({ start: 0, fragment: "aep test" })
    expect(openLinkAt("is:task [[Pro")).toEqual({ start: 8, fragment: "Pro" })
    expect(openLinkAt("[[a]] [[b")).toEqual({ start: 6, fragment: "b" })
  })

  it("is null when every link is closed or there is none", () => {
    expect(openLinkAt("[[a]]")).toBeNull()
    expect(openLinkAt("[[a]] b")).toBeNull()
    expect(openLinkAt("x")).toBeNull()
  })
})

describe("extractArchiveReveal", () => {
  const ARCHIVED: QueryExpr = { type: "modifier", field: "is", value: "archived" }

  it("no archive flag → reveal false, stages unchanged", () => {
    const { reveal, stages } = extractArchiveReveal(parseQuery("foo bar", "."))
    expect(reveal).toBe(false)
    expect(stages).toEqual([{ type: "and", exprs: [{ type: "contains", value: "foo" }, { type: "contains", value: "bar" }] }])
  })

  it("strips is:archived from a mixed stage and reveals", () => {
    const { reveal, stages } = extractArchiveReveal(parseQuery("foo is:archived", "."))
    expect(reveal).toBe(true)
    expect(stages).toEqual([{ type: "contains", value: "foo" }])
  })

  it("bare is:archived degrades to the archived predicate", () => {
    const { reveal, stages } = extractArchiveReveal(parseQuery("is:archived", "."))
    expect(reveal).toBe(true)
    expect(stages).toEqual([ARCHIVED])
  })

  it("substitutes per-stage: `xxx . is:archived` reveals archived under xxx", () => {
    const { reveal, stages } = extractArchiveReveal(parseQuery("xxx . is:archived", "."))
    expect(reveal).toBe(true)
    expect(stages).toEqual([{ type: "contains", value: "xxx" }, ARCHIVED])
  })

  it("-is:archived is a no-op (does not reveal)", () => {
    const { reveal, stages } = extractArchiveReveal(parseQuery("foo -is:archived", "."))
    expect(reveal).toBe(false)
    expect(stages).toEqual([{ type: "contains", value: "foo" }])
  })
})
