# Query Language Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the linear, whitespace-token search query parser with a recursive-descent parser that supports negating any expression (including type/attribute filters), parenthesized grouping, and a `field:value` syntax (`is:page`, `has:emoji`) in place of the single-letter `:modifier` codes — per `docs/superpowers/specs/2026-07-22-query-language-redesign-design.md`.

**Architecture:** `packages/core/src/search/query.ts` gets a character-level tokenizer feeding a recursive-descent parser (precedence: NOT > AND > OR > stage-separator). The tree-filtering engine in `search.ts` is structurally untouched — `isNegation` and `firstPassInclude` already dispatch purely on `expr.type`, so they need no changes; only the call sites that used to pre-split the query string by the separator character now call the parser directly, since stage-splitting moves inside the tokenizer (fixing a quoting bug where a literal separator inside quotes used to incorrectly split the query). Consumers outside `query.ts`/`search.ts` (the UI's `state.tsx`, and one integration test) need small updates because `parseQuery` now returns an array of per-stage expressions instead of a single expression.

**Tech Stack:** TypeScript, Bun test runner, existing `@mdtree/core` workspace package.

---

## Before you start

Read `docs/superpowers/specs/2026-07-22-query-language-redesign-design.md` — in particular the "Why `.` stays a separate stage operator" section. It explains why `is:page -is:text` (one stage) and `is:page . -is:text` (two stages) are *not* equivalent, which Task 4's tests lock in as a regression test.

The default `searchSeparator` is already `"."` in this codebase (`packages/core/src/graph/indexer.ts`, `src/view/react-context/settings.ts`) — no default-value change is needed anywhere in this plan, only how the separator is parsed.

---

### Task 1: Rewrite the query parser

**Files:**
- Modify: `packages/core/src/search/query.ts` (full rewrite)
- Test: `packages/core/src/__tests__/query.test.ts` (new file)

This is the core of the change: a character-level tokenizer (so `(`, `)`, `|`, the separator, and quotes are recognized without needing whitespace around them) feeding a recursive-descent parser. The parser never throws — a dangling `(` or stray `|` is absorbed gracefully rather than crashing live-as-you-type search.

- [ ] **Step 1: Write the failing test file**

Create `packages/core/src/__tests__/query.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/core/src/__tests__/query.test.ts`
Expected: FAIL to compile/run — `parseQuery` currently returns a single `QueryExpr`, not an array, and there is no `field`/`is`/`has` support yet.

- [ ] **Step 3: Replace `packages/core/src/search/query.ts` with the new tokenizer + parser**

Replace the entire file contents with:

```ts
import type { ParsedNode } from "../graph/types.ts"

export type QueryModifierField = "is" | "has"

export type QueryExpr =
  | { type: "contains"; value: string }
  | { type: "empty" }
  | { type: "equals"; value: string }
  | { type: "not"; expr: QueryExpr }
  | { type: "and"; exprs: QueryExpr[] }
  | { type: "or"; exprs: QueryExpr[] }
  | { type: "modifier"; field: QueryModifierField; value: string }

// ── Tokenizer ─────────────────────────────────────────────────────────────────

type Token =
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "pipe" }
  | { kind: "minus" }
  | { kind: "stage" }
  | { kind: "word"; value: string }
  | { kind: "quoted"; value: string }

function tokenize(input: string, separator: string): Token[] {
  const tokens: Token[] = []
  const isDelimiter = (c: string) => c === "(" || c === ")" || c === "|" || c === separator || c === '"'
  let i = 0

  while (i < input.length) {
    const c = input[i]

    if (/\s/.test(c)) { i++; continue }
    if (c === "(") { tokens.push({ kind: "lparen" }); i++; continue }
    if (c === ")") { tokens.push({ kind: "rparen" }); i++; continue }
    if (c === "|") { tokens.push({ kind: "pipe" }); i++; continue }
    if (c === separator) { tokens.push({ kind: "stage" }); i++; continue }
    if (c === "-") { tokens.push({ kind: "minus" }); i++; continue }

    if (c === '"') {
      let j = i + 1
      let value = ""
      while (j < input.length && input[j] !== '"') { value += input[j]; j++ }
      tokens.push({ kind: "quoted", value })
      i = j + 1
      continue
    }

    // Bareword: read until whitespace or a delimiter. A '-' does not stop
    // this scan once started, so "well-known" stays one word — only a
    // fresh '-' at a token boundary (handled above) is ever an operator.
    let j = i
    let value = ""
    while (j < input.length && !/\s/.test(input[j]) && !isDelimiter(input[j])) {
      value += input[j]
      j++
    }
    tokens.push({ kind: "word", value })
    i = j
  }

  return tokens
}

// ── Parser (recursive descent) ───────────────────────────────────────────────
//
// Precedence, tightest to loosest: NOT > AND (juxtaposition) > OR (|) > stage.
// query := stage ( SEP stage )*
// stage := orExpr
// orExpr := andExpr ( "|" andExpr )*
// andExpr := notExpr*
// notExpr := "-" atom | atom
// atom := "(" orExpr ")" | field | word | quoted
//
// The parser never throws: unmatched parens or stray operators are absorbed
// so a partially-typed query never crashes live search.

function matchField(word: string): { field: QueryModifierField; value: string } | null {
  const m = /^(is|has):(.+)$/.exec(word)
  if (!m) return null
  return { field: m[1] as QueryModifierField, value: m[2] }
}

function parseTokens(tokens: Token[]): QueryExpr[] {
  let pos = 0
  const peek = (): Token | undefined => tokens[pos]
  const advance = (): Token | undefined => tokens[pos++]

  function parseStages(): QueryExpr[] {
    const stages = [parseOr()]
    while (peek()?.kind === "stage") {
      advance()
      stages.push(parseOr())
    }
    return stages
  }

  function parseOr(): QueryExpr {
    const first = parseAnd()
    if (peek()?.kind !== "pipe") return first
    const exprs = [first]
    while (peek()?.kind === "pipe") {
      advance()
      exprs.push(parseAnd())
    }
    return { type: "or", exprs }
  }

  function parseAnd(): QueryExpr {
    const exprs: QueryExpr[] = []
    while (true) {
      const t = peek()
      if (!t || t.kind === "pipe" || t.kind === "stage" || t.kind === "rparen") break
      exprs.push(parseNot())
    }
    if (exprs.length === 0) return { type: "empty" }
    if (exprs.length === 1) return exprs[0]
    return { type: "and", exprs }
  }

  function parseNot(): QueryExpr {
    if (peek()?.kind === "minus") {
      advance()
      return { type: "not", expr: parseAtom() }
    }
    return parseAtom()
  }

  function parseAtom(): QueryExpr {
    const tok = advance()
    if (!tok) return { type: "empty" }

    if (tok.kind === "lparen") {
      const inner = parseOr()
      if (peek()?.kind === "rparen") advance()
      return inner
    }
    if (tok.kind === "quoted") {
      return { type: "equals", value: tok.value }
    }
    if (tok.kind === "word") {
      const field = matchField(tok.value)
      if (field) return { type: "modifier", field: field.field, value: field.value }
      return { type: "contains", value: tok.value }
    }
    // A stray operator token in atom position (e.g. dangling "|" or ")")
    // — swallow it rather than crashing.
    return { type: "empty" }
  }

  return parseStages()
}

export function parseQuery(query: string, separator = "."): QueryExpr[] {
  const tokens = tokenize(query.toLowerCase().trim(), separator)
  return parseTokens(tokens)
}

// ── Matching ──────────────────────────────────────────────────────────────────

const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u

export function containsEmoji(text: string): boolean {
  return emojiRegex.test(text)
}

function matchModifier(attrs: ParsedNode, field: QueryModifierField, value: string): boolean {
  if (field === "is") {
    switch (value) {
      case "page": return attrs.nodeType === "page"
      case "header": return attrs.nodeType === "header"
      case "text": return attrs.nodeType === "text"
      case "folder": return attrs.nodeType === "folder"
      case "attachment": return attrs.nodeType === "attachment"
      case "task": return attrs.nodeType === "text" && attrs.isTask === true
      default: return false
    }
  }
  // field === "has"
  switch (value) {
    case "emoji": return containsEmoji(attrs.searchKey)
    case "link":
      return attrs.nodeType === "text" &&
        attrs.parsedTokens.some(t => t.tokenType === "obsidian_link" || t.tokenType === "link")
    case "page":
      return attrs.nodeType === "text" &&
        attrs.parsedTokens.some(t => t.tokenType === "obsidian_link")
    default: return false
  }
}

export function matchQuery(attrs: ParsedNode, expr: QueryExpr): boolean {
  switch (expr.type) {
    case "empty":
      return true
    case "contains":
      return attrs.searchKey.toLowerCase().includes(expr.value.toLowerCase())
    case "equals":
      return attrs.searchKey.toLowerCase() === expr.value.toLowerCase()
    case "not":
      return !matchQuery(attrs, expr.expr)
    case "and":
      return expr.exprs.every(e => matchQuery(attrs, e))
    case "or":
      return expr.exprs.some(e => matchQuery(attrs, e))
    case "modifier":
      return matchModifier(attrs, expr.field, expr.value)
  }
}

export function firstPassInclude(attrs: ParsedNode, expr: QueryExpr): boolean {
  if (expr.type === "not") return !matchQuery(attrs, expr.expr)
  return matchQuery(attrs, expr)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/core/src/__tests__/query.test.ts`
Expected: PASS — all `describe` blocks green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/search/query.ts packages/core/src/__tests__/query.test.ts
git commit -m "$(cat <<'EOF'
feat(core): rewrite query parser with is:/has: fields, negation, grouping

Replaces the linear whitespace tokenizer with a recursive-descent
parser so any expression (including type/attribute filters) can be
negated and grouped with parentheses. Node-type modifiers move from
single-letter codes (:page) to field:value syntax (is:page, has:emoji).
EOF
)"
```

---

### Task 2: Wire the new parser into the search engine and public exports

**Files:**
- Modify: `packages/core/src/search/search.ts:108-159` (`searchIndex`, `advancedSearch`)
- Modify: `packages/core/src/index.ts:45`

`parseQuery` now does its own stage-splitting and lowercasing, so the manual `qs.split(separator).map(...).map(parseQuery)` chain collapses to one call. `isNegation` and the rest of `search.ts` need no changes — they dispatch purely on `expr.type`, which is unaffected by the modifier shape change.

- [ ] **Step 1: Update `searchIndex` and `advancedSearch` in `packages/core/src/search/search.ts`**

Replace this block (currently lines 108–123):

```ts
export function searchIndex(
  graph: NotesGraph,
  qs: string,
  separator: string,
): ResultNode[] {
  if (qs.length < 3) return []

  const expressions = qs
    .split(separator)
    .map(w => w.toLowerCase().trim())
    .map(parseQuery)

  const roots = new Map<string, ResultNode>()
  const firstPass = expressions[0]
```

with:

```ts
export function searchIndex(
  graph: NotesGraph,
  qs: string,
  separator: string,
): ResultNode[] {
  if (qs.length < 3) return []

  const expressions = parseQuery(qs, separator)

  const roots = new Map<string, ResultNode>()
  const firstPass = expressions[0]
```

Replace this block (currently lines 140–158):

```ts
export function advancedSearch(
  graph: NotesGraph,
  exactRef: string,
  query: string,
  separator: string,
): ResultNode[] {
  const nodeKey = exactRef.toLowerCase()
  if (!graph.hasNode(nodeKey)) return []

  const tree = buildTree(nodeKey, graph, new Map(), new Set())

  if (!query) return tree.children

  const expressions = query
    .split(separator)
    .map(w => w.toLowerCase().trim())
    .map(parseQuery)

  return filterDown(tree.children, expressions)
}
```

with:

```ts
export function advancedSearch(
  graph: NotesGraph,
  exactRef: string,
  query: string,
  separator: string,
): ResultNode[] {
  const nodeKey = exactRef.toLowerCase()
  if (!graph.hasNode(nodeKey)) return []

  const tree = buildTree(nodeKey, graph, new Map(), new Set())

  if (!query) return tree.children

  const expressions = parseQuery(query, separator)

  return filterDown(tree.children, expressions)
}
```

The `import { firstPassInclude, matchQuery, parseQuery, type QueryExpr } from "./query.ts"` line at the top of `search.ts` already imports `parseQuery` — no import changes needed.

- [ ] **Step 2: Update the barrel export in `packages/core/src/index.ts`**

Change line 45 from:

```ts
export { parseQuery, matchQuery, firstPassInclude, containsEmoji as queryContainsEmoji, type QueryExpr, type QueryModifier } from "./search/query.ts"
```

to:

```ts
export { parseQuery, matchQuery, firstPassInclude, containsEmoji as queryContainsEmoji, type QueryExpr, type QueryModifierField } from "./search/query.ts"
```

(`QueryModifier` was renamed to `QueryModifierField` in Task 1 since a modifier is now a `{ field, value }` pair rather than a fixed string enum.)

- [ ] **Step 3: Run the query unit tests again to confirm nothing broke**

Run: `bun test packages/core/src/__tests__/query.test.ts`
Expected: PASS (unchanged from Task 1).

- [ ] **Step 4: Run the existing integration suite to see the known, expected breakage**

Run: `bun test packages/core/src/__tests__/integration/integration.test.ts`
Expected: The `insert-mode` describe block FAILS — its helper still calls `parseQuery(query)` expecting a single `QueryExpr` back, but now gets a `QueryExpr[]`. This is fixed in Task 4. All other describe blocks (`aliases`, `basic-search`, `deep-nesting`, `multi-page`, `negation`, `page-header-link`, `archive`) should still PASS, since `searchIndex`'s behavior for plain bareword/negation/stage queries is unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/search/search.ts packages/core/src/index.ts
git commit -m "$(cat <<'EOF'
refactor(core): parse queries directly instead of pre-splitting by separator

searchIndex/advancedSearch now call parseQuery(qs, separator) once,
since stage-splitting and lowercasing moved into the parser itself.
EOF
)"
```

---

### Task 3: Update the UI's query consumers

**Files:**
- Modify: `src/view/react-context/state.tsx:130-151` (`searchResultsComputeAtom`)
- Modify: `src/view/react-context/state.tsx:393-397` (`matchTermsAtom`)
- Modify: `src/view/react-context/state.tsx:426-437` (`extractTerms`)

None of this file has a dedicated test (only `src/view/__tests__/node-actions.test.ts` exists, for a different module), so this task is verified by type-checking rather than `bun test`.

- [ ] **Step 1: Update `searchResultsComputeAtom`**

Replace (currently lines 130–151):

```ts
    const searchResultsComputeAtom = withAtomEffect(searchResultsAtom, (get, set) => {
        get(GlobalAtoms.graphVersionAtom)  // re-run on mutable graph updates from refreshPage
        const searchQuery = get(searchMol.actualQueryAtom)
        const isQuickLink = scp.isQuickLink
        const graph = get(GlobalAtoms.graphAtom)
        const separator = get(separatorAtom)

        const searchResults = searchIndex(graph, searchQuery, separator)

        // In insert (quick-link) mode, restrict the tree to notes and headers whose own
        // name/alias/heading matches the query, so only link targets are offered.
        const scoped = isQuickLink
            ? pruneResultTree(searchResults, (() => {
                // normalize separator to whitespace so multi-level queries match a node's own key
                const expr = parseQuery(searchQuery.split(separator).join(" "))
                return (n) => (n.nodeType === "page" || n.nodeType === "header") && matchQuery(n, expr)
            })())
            : searchResults

        const { visible, archivedCount } = partitionArchived(scoped)
        set(searchMol.updateSearchResultsAtom, visible, archivedCount)
    })
```

with:

```ts
    const searchResultsComputeAtom = withAtomEffect(searchResultsAtom, (get, set) => {
        get(GlobalAtoms.graphVersionAtom)  // re-run on mutable graph updates from refreshPage
        const searchQuery = get(searchMol.actualQueryAtom)
        const isQuickLink = scp.isQuickLink
        const graph = get(GlobalAtoms.graphAtom)
        const separator = get(separatorAtom)

        const searchResults = searchIndex(graph, searchQuery, separator)

        // In insert (quick-link) mode, restrict the tree to notes and headers whose own
        // name/alias/heading matches the query, so only link targets are offered.
        const scoped = isQuickLink
            ? pruneResultTree(searchResults, (() => {
                // AND all stages together so a node's own key must match every term
                // across the whole query, regardless of hierarchy stage boundaries.
                const expr: QueryExpr = { type: "and", exprs: parseQuery(searchQuery, separator) }
                return (n: ParsedNode) => (n.nodeType === "page" || n.nodeType === "header") && matchQuery(n, expr)
            })())
            : searchResults

        const { visible, archivedCount } = partitionArchived(scoped)
        set(searchMol.updateSearchResultsAtom, visible, archivedCount)
    })
```

(`QueryExpr` and `ParsedNode` are already imported at the top of this file — no import changes needed.)

- [ ] **Step 2: Update `matchTermsAtom`**

Replace (currently lines 393–397):

```ts
    const matchTermsAtom = atom<string[]>((get) => {
        const query = get(actualQueryAtom)
        if (!query) return []
        return extractTerms(parseQuery(query))
    })
```

with:

```ts
    const matchTermsAtom = atom<string[]>((get) => {
        const query = get(actualQueryAtom)
        if (!query) return []
        const separator = get(separatorAtom)
        return parseQuery(query, separator).flatMap(extractTerms)
    })
```

- [ ] **Step 3: Update `extractTerms` to drop the removed `startsWith` variant**

Replace (currently lines 426–437):

```ts
function extractTerms(expr: QueryExpr): string[] {
    switch (expr.type) {
        case "contains":   return [expr.value]
        case "startsWith": return [expr.value]
        case "equals":     return [expr.value]
        case "and":        return expr.exprs.flatMap(extractTerms)
        case "or":         return expr.exprs.flatMap(extractTerms)
        case "not":        return []
        case "modifier":   return []
        case "empty":      return []
    }
}
```

with:

```ts
function extractTerms(expr: QueryExpr): string[] {
    switch (expr.type) {
        case "contains":   return [expr.value]
        case "equals":     return [expr.value]
        case "and":        return expr.exprs.flatMap(extractTerms)
        case "or":         return expr.exprs.flatMap(extractTerms)
        case "not":        return []
        case "modifier":   return []
        case "empty":      return []
    }
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: No errors. (This also catches any other stale reference to the removed `startsWith` variant or the renamed `QueryModifier` type across `src/` and `packages/`.)

- [ ] **Step 5: Commit**

```bash
git add src/view/react-context/state.tsx
git commit -m "$(cat <<'EOF'
refactor(ui): adapt to parseQuery's new multi-stage return shape

parseQuery now returns one QueryExpr per hierarchy stage instead of a
single expression, and the startsWith variant was removed from
QueryExpr. Update the quick-link filter and term-highlighting atoms
accordingly.
EOF
)"
```

---

### Task 4: Fix the insert-mode integration test and add a regression test for the two-stage pruning distinction

**Files:**
- Modify: `packages/core/src/__tests__/integration/integration.test.ts`
- Create: `packages/core/src/__tests__/integration/fixtures/type-filters/notes.md`

- [ ] **Step 1: Update imports in `integration.test.ts`**

Replace (currently lines 1–6):

```ts
import { describe, it, expect } from "bun:test"
import { loadFixture, search, searchKeys } from "./helpers.ts"
import { partitionArchived } from "../../search/archive.ts"
import { pruneResultTree, type ResultNode } from "../../search/search.ts"
import { matchQuery, parseQuery } from "../../search/query.ts"
import type { ParsedNode } from "../../graph/types.ts"
```

with:

```ts
import { describe, it, expect } from "bun:test"
import { loadFixture, search, searchKeys } from "./helpers.ts"
import { partitionArchived } from "../../search/archive.ts"
import { pruneResultTree, type ResultNode } from "../../search/search.ts"
import { matchQuery, parseQuery, type QueryExpr } from "../../search/query.ts"
import { DEFAULT_SETTINGS } from "../../graph/indexer.ts"
import type { ParsedNode } from "../../graph/types.ts"
```

- [ ] **Step 2: Fix the `insert-mode` describe block's helper**

Replace (currently lines 217–226):

```ts
describe("insert-mode", () => {
  const g = loadFixture("insert-mode")

  // Mirrors the filter used by the Insert Link modal (searchResultsComputeAtom).
  function insertResults(query: string): ResultNode[] {
    const expr = parseQuery(query)
    const keep = (n: ParsedNode) =>
      (n.nodeType === "page" || n.nodeType === "header") && matchQuery(n, expr)
    return pruneResultTree(search(g, query), keep)
  }
```

with:

```ts
describe("insert-mode", () => {
  const g = loadFixture("insert-mode")

  // Mirrors the filter used by the Insert Link modal (searchResultsComputeAtom).
  function insertResults(query: string): ResultNode[] {
    const expr: QueryExpr = { type: "and", exprs: parseQuery(query, DEFAULT_SETTINGS.searchSeparator) }
    const keep = (n: ParsedNode) =>
      (n.nodeType === "page" || n.nodeType === "header") && matchQuery(n, expr)
    return pruneResultTree(search(g, query), keep)
  }
```

(The rest of the `insert-mode` describe block — the three `it(...)` cases below it — is unchanged.)

- [ ] **Step 3: Run the integration suite to confirm `insert-mode` passes again**

Run: `bun test packages/core/src/__tests__/integration/integration.test.ts`
Expected: PASS — all describe blocks green, including `insert-mode`.

- [ ] **Step 4: Add the `type-filters` fixture**

Create `packages/core/src/__tests__/integration/fixtures/type-filters/notes.md`:

```markdown
# Notes Home

## Overview

- Buy groceries
- Write the quarterly report
```

- [ ] **Step 5: Add the `type-filters` describe block**

Append to the end of `packages/core/src/__tests__/integration/integration.test.ts`:

```ts

// ── type-filters (is:/has: field syntax) ─────────────────────────────────────

describe("type-filters", () => {
  const g = loadFixture("type-filters")

  it("is:page finds the page root with its whole subtree, text lines included", () => {
    const keys = searchKeys(g, "is:page")
    expect(keys.some(k => k.includes("notes home"))).toBe(true)
    expect(keys.some(k => k.includes("groceries"))).toBe(true)
  })

  it("is:page -is:text (single stage) still keeps text lines: matching a node keeps its whole subtree", () => {
    const keys = searchKeys(g, "is:page -is:text")
    expect(keys.some(k => k.includes("notes home"))).toBe(true)
    expect(keys.some(k => k.includes("groceries"))).toBe(true)
  })

  it("is:page.-is:text (two stages) prunes text lines from within the matched page", () => {
    const keys = searchKeys(g, "is:page.-is:text")
    expect(keys.some(k => k.includes("notes home"))).toBe(true)
    expect(keys.some(k => k.includes("overview"))).toBe(true)
    expect(keys.some(k => k.includes("groceries"))).toBe(false)
  })

  it("has:emoji matches only nodes with an emoji in their search key", () => {
    const keys = searchKeys(g, "has:emoji")
    expect(keys).toHaveLength(0) // fixture has no emoji content
  })
})
```

- [ ] **Step 6: Run the integration suite to verify the new tests pass**

Run: `bun test packages/core/src/__tests__/integration/integration.test.ts`
Expected: PASS — all describe blocks green, including the new `type-filters` block. This test locks in the design doc's central example as an executable regression test: single-stage `is:page -is:text` does *not* prune, two-stage `is:page.-is:text` does.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/__tests__/integration/integration.test.ts packages/core/src/__tests__/integration/fixtures/type-filters/
git commit -m "$(cat <<'EOF'
test(core): fix insert-mode helper for new parseQuery shape, add type-filters coverage

Adds a regression test for the documented distinction between
single-stage `is:page -is:text` (keeps whole matched subtree) and
two-stage `is:page.-is:text` (prunes text nodes from within it).
EOF
)"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `bun test`
Expected: All tests pass across every package (`packages/core`, `packages/cli`, and any others `bun test` discovers).

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: No errors.

- [ ] **Step 3: Manually sanity-check the new syntax examples from the design doc**

Using the CLI (`bun run packages/cli/src/main.ts query <vault-dir> "is:page"` or the equivalent `mdtree:dev` script against a real or scratch vault), confirm at least these two queries from the design doc's Examples table behave as documented:
- `is:page` — returns page nodes with children intact.
- `is:page.-is:text` — returns page nodes with text-node children pruned.

If no vault is handy, this step can be satisfied by re-reading the Task 4 `type-filters` test output as the executable proof — note in your final report which method you used.

No commit for this task — it's verification of work already committed in Tasks 1–4. If any step surfaces a problem, fix it in the relevant task's files and create a new commit for the fix.
