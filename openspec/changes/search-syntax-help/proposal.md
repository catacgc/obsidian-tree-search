# Search Syntax Help (zero-state cheat sheet)

## Problem

When the search panel is opened with nothing typed — or when a query returns no matches — the
results area below the search bar is simply **blank** (`SearchViewFlatten` maps an empty
`renderableNodes` to nothing). The query language is powerful (`is:`/`has:`/`in:`, negation,
grouping, `|` OR, `.` stage/hierarchy, legacy `:x` shortcuts) but entirely undiscoverable: the only
hint today is the `is:`/`has:`/`in:` autocomplete, which appears only after you already know to type
those prefixes.

New users see an empty box and don't know what they can do; existing users forget the exact operator
spellings.

## Proposal

Fill the empty results area with an **inline, nicely-rendered syntax cheat sheet** whenever there is
nothing to show. Entries for concrete tokens (`is:`, `has:`, `in:`, legacy `:x`) are **click-to-insert
launchers**; grammar patterns (AND/OR/NOT/grouping/stage) and free-text examples are shown as static
illustrations.

The cheat-sheet content is **not hardcoded in React**. Core gains a self-describing grammar function,
`describeQuerySyntax()`, generated from the existing `IS_VALUES` / `HAS_VALUES` constants (plus a
description map), so the help can never silently drift from what the parser actually accepts. A
drift-guard test enforces this. The function is reusable beyond the plugin (e.g. a future
`mdtree query --help`, README generation).

```
SearchViewFlatten
  !isLoading && renderableNodes.length === 0
        │
        ▼
   <SearchHelp query onInsert />
        │
        ▼
   describeQuerySyntax(): QuerySyntaxGroup[]
        ├─ entry.insertText present → <button> (click → append token)
        └─ entry.insertText absent  → <span>   (static illustration)
```

## Scope

### Trigger (zero-state)

Shown when `!isLoading && renderableNodes.length === 0`, with two header variants:

| Condition | Header |
|-----------|--------|
| Query is empty / whitespace / below the 3-char search minimum | `Search syntax` (idle) |
| Query has ≥3 chars but zero matches | `No results for "<query>"` — then the same card as a "try these" affordance |

### Cheat-sheet content (from `describeQuerySyntax()`)

| Group | Entries | Clickable? |
|-------|---------|-----------|
| Text | `foo` (contains), `"foo bar"` (exact) | no (illustration) |
| Type — `is:` | `is:page` `is:header` `is:text` `is:folder` `is:attachment` `is:task` | **yes** — generated from `IS_VALUES` |
| Content — `has:` | `has:emoji` `has:link` `has:page` | **yes** — generated from `HAS_VALUES` |
| Recency — `in:` | `in:7d` `in:2w` `in:1m` `in:1y` | **yes** (presets) |
| Combine | `a b` (AND) `a \| b` (OR) `-a` (NOT) `(a \| b) c` (group) `a . b` (stage) | no (illustration) |
| Legacy | `:page` `:header` `:folder` `:attachment` `:task` `:emoji` | **yes** |

### Click-to-insert semantics

- Empty query → set the query to the token (e.g. `is:task`).
- Non-empty query → **append** the token at the end, space-separated (`zzz` → `zzz is:task`).
- After insert, focus the search input and place the cursor at the end.
- Only entries with `insertText` are buttons; grammar/free-text entries are non-interactive.

## Key Files

| File | Change |
|------|--------|
| `packages/core/src/search/syntax.ts` *(new)* | `describeQuerySyntax()` + `QuerySyntaxGroup`/`QuerySyntaxEntry` types; `is:`/`has:` groups generated from `IS_VALUES`/`HAS_VALUES` |
| `packages/core/src/index.ts` | Export `describeQuerySyntax` and the syntax types |
| `packages/core/src/__tests__/` | Drift guard: every `IS_VALUES`/`HAS_VALUES` value appears exactly once with a non-empty description; every `insertText` re-parses to the expected modifier |
| `src/view/search/SearchHelp.tsx` *(new)* | Inline zero-state panel; renders groups, click-to-insert buttons, idle vs no-match header |
| `src/view/search/SearchViewFlatten.tsx` | Render `<SearchHelp/>` in the `renderableNodes.length === 0` branch |
| `src/view/react-context/state.tsx` | Insert helper (append/set on `searchQueryAtom`) + input-focus signal atom |
| `src/view/search/SearchBar.tsx` | Consume the focus-signal atom to focus the `<input>` after an insert |

## Non-goals

- No floating/modal window — strictly an inline panel in the existing results area.
- No change to the parser/matcher grammar; this only *describes* what already exists.
- Not wiring `describeQuerySyntax()` into the autocomplete dropdown or a CLI `--help` yet (the
  function is designed to enable those later, but they're out of scope here).
- URL-path substring behavior and other matching semantics are untouched.

## Success Criteria

- Opening search with an empty box shows the grouped syntax card titled `Search syntax`.
- A query with ≥3 chars and zero matches shows `No results for "<query>"` above the same card.
- Clicking `is:task` on an empty box sets the query to `is:task` and runs the search; clicking it
  with `zzz` already typed yields `zzz is:task`; the input is focused afterward.
- Grammar entries (`a . b`, `-a`, …) and free-text examples are visible but not clickable.
- Adding a new `is:`/`has:` value to core without describing it fails the drift-guard test.
- Styling uses Obsidian theme variables (`--obs-*` / Tailwind), matching the existing panel in light
  and dark themes.
