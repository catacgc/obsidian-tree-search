# Legacy Shortcuts, Prefix Matching, and Search Autocomplete

Date: 2026-07-24

## Overview

The query language redesign (`docs/superpowers/specs/2026-07-22-query-language-redesign-design.md`)
replaced the old single-letter `:page`/`:task`/`:emoji`/etc. modifiers with an
`is:`/`has:` field:value syntax. That rewrite dropped two things users relied
on: the old system's prefix-based abbreviation (`:p`, `:e`, `:pag`, ... all
resolved against a fixed 6-item modifier list), and any way to abbreviate the
new field values (`has:e` for `has:emoji`). It also left the new syntax's
value vocabulary undiscoverable once you're typing `is:`/`has:` — there's no
in-app hint of what values each field accepts.

This design adds three related capabilities on top of the existing parser:

1. Legacy bare shortcuts (`:p`, `:e`, ...) work again, mapped onto the new
   `is:`/`has:` syntax.
2. `is:`/`has:` values can be abbreviated by unambiguous prefix (`has:e` →
   `has:emoji`).
3. An autocomplete dropdown suggests matching values once you've typed a
   complete `is:`/`has:` field prefix.

All three are additive to the existing grammar (`docs/superpowers/specs/2026-07-22-query-language-redesign-design.md`)
— no existing behavior changes for queries that don't use these new
abbreviation paths.

## Goals

- `:p`, `:e`, `:t`, `:h`, `:f`, `:a` (and their full old names, `:page`,
  `:emoji`, etc., and any unambiguous prefix of them) resolve to their new
  `is:`/`has:` equivalent, exactly reproducing pre-redesign behavior.
- `is:x` / `has:x` resolve `x` against that field's value list by unambiguous
  prefix; an ambiguous or unknown `x` matches nothing (consistent with the
  existing "unrecognized field value matches nothing" behavior — no new
  failure mode).
- A dropdown appears under the search input once a complete `is:`/`has:`
  prefix has been typed, showing all values for that field matching what's
  typed so far (including showing multiple candidates when a prefix is
  ambiguous, since the dropdown's job is letting the user disambiguate by
  picking).
- `Tab` accepts the highlighted suggestion; `Escape` dismisses the dropdown;
  clicking a suggestion also accepts it. None of this changes behavior for
  `ArrowUp`/`ArrowDown`/`Enter` once the dropdown is closed.

## Non-goals

- No change to `matchQuery`/`matchModifier`'s core switch logic — resolution
  happens entirely at parse time, before an AST node is built.
- The dropdown does not surface the legacy bare shortcuts (`:p`, ...) as
  suggestions — only `is:`/`has:` values. Legacy shortcuts remain a typing
  shortcut for existing muscle memory, not a taught feature.
- The dropdown does not attempt to suggest the field names `is:`/`has:`
  themselves before they're typed. Structurally, a leading `:` belongs only
  to the legacy grammar (the new syntax's colon comes *after* the field
  name, e.g. `is:page`, not before it), and bare letters (`i`, `is`, `h`,
  `ha`) are far too common in ordinary search terms to safely trigger a
  popup — "is" alone is a perfectly normal thing to search for. So
  autocomplete only activates once a complete `is:` or `has:` prefix has
  been typed; remembering that the two field names exist is left to
  documentation/muscle memory, same as today.
- No fuzzy matching, no ranking/scoring, no typo-tolerance beyond prefix
  matching.
- No in-app general search-help panel (operators/shortcuts overview) — an
  earlier design proposed one but it was never built; still out of scope
  here. This design only covers inline autocomplete while typing.

## 1. Shared prefix-resolution primitive

Both legacy-shortcut resolution and field-value abbreviation are the same
operation applied to different candidate lists, so both go through one
function, added to `packages/core/src/search/query.ts`:

```ts
function resolveUniquePrefix(candidates: string[], typed: string): string | null {
  if (candidates.includes(typed)) return typed
  const matches = candidates.filter(c => c.startsWith(typed))
  return matches.length === 1 ? matches[0] : null
}
```

Exact match always wins outright, even if it's also a prefix of a longer
candidate (not currently possible with today's value lists, but the rule is
stated for robustness). Otherwise: exactly one prefix match resolves; zero
or multiple do not.

## 2. Legacy bare shortcuts

A fixed alias table, exported from `query.ts`, reproducing the pre-redesign
`QUERY_MODIFIERS` list exactly — six canonical names, each mapped to its new
field:value equivalent:

```ts
const LEGACY_MODIFIERS: Record<string, { field: QueryModifierField; value: string }> = {
  page: { field: "is", value: "page" },
  header: { field: "is", value: "header" },
  folder: { field: "is", value: "folder" },
  attachment: { field: "is", value: "attachment" },
  task: { field: "is", value: "task" },
  emoji: { field: "has", value: "emoji" },
}
```

`text` is deliberately **not** in this table — it didn't exist before the
redesign, so `:t` stays unambiguous (resolves only to `task`, exactly as
before) regardless of `is:text` existing in the new syntax.

**Parsing:** in `parseAtom`'s word-handling branch, a word matching
`/^:([a-z]+)$/i` (starts with a literal `:`, followed by letters, and does
*not* match the `is:`/`has:` field pattern — which it never will, since that
pattern requires the literal field name first) is resolved via
`resolveUniquePrefix(Object.keys(LEGACY_MODIFIERS), lettersLowercased)`:
- Resolved → emit `{ type: "modifier", field: LEGACY_MODIFIERS[resolved].field, value: LEGACY_MODIFIERS[resolved].value }`.
- Not resolved (no match) → fall back to `{ type: "contains", value: word }`,
  i.e. treat the whole token (including the colon) as literal text — this
  matches the old parser's behavior for an unrecognized `:xyz`.
- Not resolved (ambiguous, 2+ matches) — not reachable with today's 6-name
  list (no name is a prefix of another), but for robustness against future
  additions: emit a modifier node with the raw (unresolved) value, which
  `matchModifier`'s existing default-case-returns-false handles the same
  way as an unrecognized field value.

Negation (`-:p`) and hierarchy stages work automatically — this all happens
inside the same `parseAtom` call that `parseNot` and stage-splitting already
wrap uniformly; no changes needed there.

## 3. Prefix matching for `is:`/`has:` values

New exported canonical lists in `query.ts`:

```ts
const IS_VALUES = ["page", "header", "text", "folder", "attachment", "task"]
const HAS_VALUES = ["emoji", "link", "page"]
```

In `matchField` (the function that currently does `/^(is|has):(.+)$/` and
returns `{field, value}` verbatim), after extracting `field`/`typedValue`,
run `resolveUniquePrefix(field === "is" ? IS_VALUES : HAS_VALUES, typedValue)`:
- Resolved → use the resolved canonical value in the `{type:"modifier", ...}` node.
- Not resolved → use `typedValue` as-is. `matchModifier`'s existing
  switch/default-false handles an unrecognized value by matching nothing —
  **no changes needed to `matchModifier`/`matchQuery` at all.**

`has:e` → `has:emoji` (unique). `is:t` stays ambiguous (`task` and `text`
both real values) → matches nothing, per the earlier design decision.

## 4. Autocomplete UI

### 4a. Suggestion logic (pure, framework-agnostic)

New file `packages/core/src/search/suggest.ts`:

```ts
export type Suggestion = { label: string; insertText: string }

export function suggestAt(query: string, cursorPos: number): Suggestion[] {
  // The token immediately before the cursor is everything since the last
  // space (or the start of the string, if there is no earlier space).
  const before = query.slice(0, cursorPos)
  const tokenStart = before.lastIndexOf(" ") + 1
  const token = before.slice(tokenStart).toLowerCase()

  // Only a complete "is:x" or "has:x" token triggers suggestions — see the
  // Non-goals section for why bare letters or a leading ":" don't.
  const match = /^(is|has):([a-z]*)$/.exec(token)
  if (!match) return []

  const [, field, typed] = match
  const values = field === "is" ? IS_VALUES : HAS_VALUES
  return values
    .filter(v => v.startsWith(typed) && v !== typed)
    .map(v => ({ label: `${field}:${v}`, insertText: `${field}:${v}` }))
}
```

`tokenStart` is correct in both cases without special-casing: if `before`
has no space, `lastIndexOf(" ")` is `-1` and `tokenStart` is `0` (the whole
string is one token); if it does, `tokenStart` is one past the last space.

### 4b. UI integration

- New atoms in `src/view/react-context/state.tsx` (in `SearchViewMolecule`,
  alongside the existing `searchQueryAtom`, `selectedLineAtom`, etc.):
  - `cursorPosAtom` — updated on every input change/click/selection.
  - `suggestionsAtom` — derived from `searchQueryAtom` + `cursorPosAtom` via
    `suggestAt`.
  - `suggestionIndexAtom` — currently-highlighted suggestion, reset to 0
    whenever `suggestionsAtom` changes.
- New component `src/view/search/SearchAutocomplete.tsx`, rendered inside
  `SearchBar.tsx`, absolutely positioned directly under the input, showing
  `suggestionsAtom`'s current list with the highlighted index visually
  marked. Renders nothing when the list is empty.
- **Keyboard handling**, added to the input element itself in
  `SearchBar.tsx` (not `KeyComboWrapper.tsx`, which wraps the whole modal
  including the results list):
  - While `suggestionsAtom` is non-empty: `ArrowDown`/`ArrowUp` move
    `suggestionIndexAtom`; `Tab` splices the highlighted suggestion's
    `insertText` into the query at the current token's position, moves the
    cursor past it, and clears suggestions; `Escape` clears suggestions
    without changing the query. All four calls `event.stopPropagation()`
    so `KeyComboWrapper`'s outer handler (bound on an ancestor div, per
    React's bubbling) never sees these keystrokes while the dropdown is open.
  - While `suggestionsAtom` is empty: the input's `onKeyDown` does nothing
    extra, so `ArrowUp`/`ArrowDown`/`Enter` continue to bubble up to
    `KeyComboWrapper` exactly as today — zero behavior change for the
    existing result-navigation shortcuts.
  - Clicking a suggestion in the dropdown performs the same splice as `Tab`.

## Testing

- `packages/core/src/__tests__/query.test.ts`: unit tests for
  `resolveUniquePrefix` (exact match wins, unique prefix resolves, ambiguous
  and unknown both return `null`), the legacy-shortcut parser branch
  (`:p` → `is:page`, `:t` → `is:task` and stays unambiguous despite
  `is:text` existing, `:xyz` falls back to literal `contains`), and
  `is:`/`has:` prefix resolution (`has:e` → `has:emoji`, `is:t` matches
  nothing).
- New `packages/core/src/__tests__/suggest.test.ts`: unit tests for
  `suggestAt` covering `is:` (all six values), `is:p` (single match,
  `page`), `is:t` (two matches, both `task` and `text` returned), `has:e`
  (single match, `emoji`), an exact full match like `is:page` (empty —
  nothing left to complete), and plain non-field text / bare letters like
  `is`/`ha` with no colon (no suggestions, empty array).
- The dropdown's UI/keyboard interaction (`SearchAutocomplete.tsx`,
  `SearchBar.tsx`'s key handling) has no existing automated test
  infrastructure at this layer (same situation as `state.tsx` today, which
  has no dedicated test file) — verified manually via `webapp-testing` once
  built: type `is:`, confirm dropdown appears showing all six `is:` values;
  type `is:t`, confirm both `is:task`/`is:text` show; press `Tab`, confirm
  the highlighted one splices in; press `Escape`, confirm dropdown closes
  without changing the query; confirm `ArrowUp`/`ArrowDown`/`Enter` still
  navigate results normally when the dropdown isn't open.

## Migration and Rollout

### Breaking Changes

None. All three additions are backward compatible with the current `is:`/
`has:` syntax — existing full-form queries parse identically. The legacy
shortcuts are a pure addition (previously `:p` parsed as literal text
`contains(":p")`; now it resolves to `is:page`, which is what users of the
pre-redesign syntax would expect and is strictly more useful, not a
behavior anyone was relying on the old way).

### Rollout Plan

1. Implement the shared resolver, legacy alias table, and field-value
   prefix matching in `query.ts`, with unit tests.
2. Implement `suggest.ts` with unit tests.
3. Wire up the UI (atoms, `SearchAutocomplete.tsx`, `SearchBar.tsx` keyboard
   handling), verified manually.

## Future Enhancements

- Surfacing legacy shortcuts in the dropdown too, if users ask for it.
- A general in-app search-help panel (previously proposed, never built)
  that documents the full grammar, complementing rather than replacing this
  inline autocomplete.
- Fuzzy/typo-tolerant matching if prefix-only proves too strict in practice.
