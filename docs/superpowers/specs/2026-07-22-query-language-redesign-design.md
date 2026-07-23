# Query Language Redesign

Date: 2026-07-22

## Overview

The current search query language (`packages/core/src/search/query.ts`) is a
flat, linear tokenizer: whitespace-separated words are ANDed, `|` splits
top-level OR groups, `-word` negates a single contains-check, `"word"` is an
exact match (and, oddly, an *unclosed* leading quote means startsWith), and
single-letter modifiers (`:page`, `:task`, `:header`, `:folder`,
`:attachment`, `:emoji`) filter by node type or attribute. A separate
character (default `.`, configurable via the `searchSeparator` setting) splits the whole query string into
sequential stages that are applied one after another down the result tree.

This works for simple queries but breaks down for compound intent. In
particular, there is no way to negate a type modifier (`-:text` parses as
"NOT contains the literal text `:text`", not "NOT text-typed node") and no
grouping, so nothing like "pages but not their text-node children" can be
expressed in one query.

This design replaces the linear tokenizer with a small recursive-descent
parser supporting full negation, grouping, and a `field:value` syntax for
type/attribute filters, while keeping the tree-search engine in
`search.ts` conceptually unchanged.

## Goals

- Negation (`-`) applies uniformly to any expression: a word, a `field:value`
  filter, or a parenthesized group.
- Parenthesized grouping: `(a | b) -is:text`.
- Node-type and attribute filters move from single-letter modifiers
  (`:page`) to a `field:value` syntax (`is:page`), with two field names:
  `is:` for the node's own kind/state, `has:` for content the node contains.
- The hierarchical stage separator (already default `.`, configurable) is
  preserved as a distinct concept — see "Why `.` stays a separate operator"
  below — but is parsed by the same tokenizer/parser instead of a naive
  `string.split()`, fixing quoting edge cases (a literal separator character
  inside a quoted phrase no longer incorrectly splits the query).
- Breaking changes are acceptable. This is not required to be a superset of
  the current syntax; docs and the in-app search help are updated together
  with this change.

## Non-goals

- Prefix/"starts-with" matching (today's confusing unclosed-quote hack) is
  dropped, not replaced. Can be added later as an explicit operator (e.g.
  `^word`) if requested.
- No new node-level capabilities beyond what `is:`/`has:` expose today
  (`page`, `header`, `text`, `folder`, `attachment`, `task` for `is:`;
  `emoji`, `link`, `page` for `has:`). Additional fields (`is:done`,
  `has:tag`, date filters, etc.) are future work — the field syntax is
  designed to accept them without further grammar changes.
- No changes to how results are ranked/sorted, how the tree is built
  (`buildTree`), or to `advancedSearch` / `searchParents` beyond consuming
  the new parser.

## Grammar

```
query      := stage ( "." stage )*        // sequential subtree-descent stages
stage      := orExpr
orExpr     := andExpr ( "|" andExpr )*
andExpr    := notExpr ( notExpr )*        // juxtaposition = AND
notExpr    := "-" atom | atom
atom       := "(" orExpr ")" | field | term
field      := ("is" | "has") ":" ident
term       := '"' text '"' | bareword
```

Precedence, tightest to loosest: `NOT` → `AND` (implicit, juxtaposition) →
`OR` (`|`) → stage (`.`). Parentheses group anything at the `orExpr` level
and below. **`.` cannot appear inside parentheses** — it is only a top-level
stage separator. See rationale below.

Tokens that need escaping to appear literally in a bareword: `-` (only
meaningful as a prefix), `|`, `(`, `)`, `.`, `:` (only meaningful inside a
field name position), and `"`. Any of these can be matched literally by
wrapping the term in quotes, e.g. `"c++"` or `"3.5"`.

## Why `.` stays a separate stage operator (not folded into AND/NOT)

`search.ts` applies a query differently depending on whether it's within a
stage or across stages:

- Within one stage, a node that matches keeps its **entire subtree**
  (`filterTreeByWord` returns the whole node, children included, once it
  matches and the expression isn't a pure negation).
- Across stages (`filterDown`), each subsequent stage re-filters what
  survived the previous one, walking back into the already-matched subtrees.

This means `is:page -is:text` (single stage) and `is:page . -is:text` (two
stages) do *not* mean the same thing:

- `is:page -is:text` — the `-is:text` term is redundant (a page is never
  text-typed); this just selects page roots and keeps their whole subtree,
  text children included.
- `is:page . -is:text` — stage 1 selects page roots; stage 2 walks into each
  matched subtree and prunes out every text node (and everything under it),
  keeping other node types. **This is the "pages but not text nodes" query.**

Folding `.` into the same precedence level as AND/OR would erase this
distinction and silently change what compound negations mean. Keeping it as
the outermost, non-nestable operator preserves today's mental model
(`parent / child` → `parent . child`) while still giving each stage the full
expressiveness of the new grammar (negation, grouping, fields).

## Field taxonomy

| Field | Values | Meaning |
|---|---|---|
| `is:` | `page`, `header`, `text`, `folder`, `attachment`, `task` | The node's own kind (node type), or `task` for a text node that is a checkbox item |
| `has:` | `emoji`, `link`, `page` | The node's content contains this — `has:emoji` (emoji in the search key), `has:link` (any wikilink), `has:page` (a wikilink to a page itself, as opposed to a link into a header fragment within one (`[[Note]]` vs `[[Note#Header]]`)) |

`is:page` and `has:page` are deliberately distinct: the former is the node's
own type, the latter is about what the node references.

Internal-only node types (`month`, `folderNote`, `pointer`) are not exposed
as `is:` values in this pass — they aren't part of the current modifier set
either, and adding them is low-risk future work if a need arises.

## Behavior changes vs. today

| Old | New |
|---|---|
| `-word` | `-word` (unchanged — negation now generalizes) |
| `:page` / `:task` / `:header` / `:folder` / `:attachment` | `is:page` / `is:task` / `is:header` / `is:folder` / `is:attachment` |
| `:emoji` | `has:emoji` |
| *(none — text nodes weren't filterable)* | `is:text` (new) |
| `"word"` exact match | unchanged — exact literal phrase |
| `"word` (unclosed quote) = startsWith | removed (see Non-goals) |
| `a \| b` | unchanged |
| `parent . child` (stage separator, configurable, default `.`) | unchanged — stage splitting now happens inside the parser instead of a pre-split, fixing quoting edge cases |
| no grouping | `(a \| b) -is:text` now legal |
| no negation on modifiers | `-is:text`, `-has:emoji`, `-(a \| b)` now legal |

## Architecture

### `packages/core/src/search/query.ts`

Replace the current `tokenize` / `parseOrGroups` / `parseAndGroup` /
`parseToken` linear scan with:

1. A tokenizer that recognizes: `.`, `|`, `-`, `(`, `)`, `field:value`
   (identifier immediately followed by `:` and another identifier, no
   whitespace), quoted strings (respecting escaped/embedded quotes), and
   barewords. This replaces the naive `qs.split(separator)` currently done
   in `search.ts` — the separator character becomes a token the tokenizer
   emits, so it's separator-aware inside quotes.
2. A recursive-descent parser implementing the grammar above, producing the
   same shape of `QueryExpr` AST as today (`contains`, `equals`, `not`,
   `and`, `or`, `modifier` types), with `modifier` generalized to carry a
   `field` (`"is" | "has"`) and `value` instead of a fixed string enum.
3. `matchQuery` and `firstPassInclude` keep their current shape; the
   `modifier` case switches on `expr.field` then `expr.value` instead of
   prefix-matching `:t`/`:e`/`:p`/etc.

### `packages/core/src/search/search.ts`

- `searchIndex` and `advancedSearch` currently do
  `qs.split(separator).map(...).map(parseQuery)` — this becomes a single
  `parseQuery(qs, separator)` call, since stage-splitting moves inside the
  parser/tokenizer.
- `isNegation` (used to decide `pruneMatchingTree`) stays as-is conceptually
  — "is this stage's top-level expression a pure negation (or an AND of pure
  negations)?" — but needs to also recognize a negated `field:value`
  modifier as a negation, which falls out naturally once `not` wraps any
  atom including the generalized `modifier` type.
- `buildTree`, `filterTreeByWord`, `filterDown`, `pruneResultTree` are
  unchanged.

### UI / docs

- No in-app search help component exists yet (an earlier design proposed one
  but it was never built), so there's no existing help text to migrate.
  Out of scope for this change; a future help component should document the
  new syntax when it's built.
- No change to the `searchSeparator` setting or its default (`.`) — only its
  parsing moves from a pre-split into the unified parser.

## Examples

| Query | Meaning |
|---|---|
| `is:page` | All page nodes (whole subtree kept) |
| `is:page . -is:text` | Pages, with all text nodes pruned from within them |
| `-has:emoji` | Nodes without an emoji in their title |
| `(meeting \| standup) is:header` | Headers containing "meeting" or "standup" |
| `is:task -is:page` | Task items that aren't page nodes (redundant but legal) |
| `project . (urgent \| blocked) -is:text` | Within "project"'s subtree, urgent or blocked items, excluding text nodes |
| `"exact phrase"` | Exact literal match on search key |

## Testing Strategy

- Unit tests for the tokenizer/parser in `query.ts`: every grammar
  production (fields, negation of fields, negation of groups, nested
  parens, stage splitting, quoted phrases containing the separator
  character).
- Unit tests for `matchQuery`/`firstPassInclude` covering each `is:`/`has:`
  value against each node type.
- Integration tests in `search.ts` reproducing the `is:page . -is:text`
  two-stage pruning example, and confirming the single-stage
  `is:page -is:text` case does *not* prune (documents the distinction from
  this design doc so a future refactor can't silently collapse it).
- Update existing tests that reference the old `:modifier` syntax to the new
  `is:`/`has:` syntax.

## Migration and Rollout

### Breaking Changes

Yes, intentionally (see Goals). Anyone with saved/remembered queries using
`:page`, `:task`, etc., or the unclosed-quote startsWith trick, will need to
switch to the new syntax. The hierarchy separator itself (`.` by default) is
unaffected.

### Rollout Plan

1. Implement parser + engine changes, update all existing tests.
2. Release notes documenting the breaking syntax change (`:mod` → `is:`/`has:`,
   startsWith removed).

## Future Enhancements

- Explicit prefix-match operator (e.g. `^word`) if startsWith is needed
  again.
- Additional `is:`/`has:` fields: `is:done`, `has:tag`, date-based filters.
- Exposing internal node types (`month`, `folderNote`, `pointer`) as `is:`
  values if a use case arises.
