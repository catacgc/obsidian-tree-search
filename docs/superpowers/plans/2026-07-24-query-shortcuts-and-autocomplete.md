# Legacy Shortcuts, Prefix Matching, and Search Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring back the old `:p`/`:e`-style bare shortcuts (mapped onto the new `is:`/`has:` syntax), let `is:`/`has:` values be abbreviated by unambiguous prefix (`has:e` → `has:emoji`), and add an autocomplete dropdown that suggests matching values once a full `is:`/`has:` prefix is typed.

**Architecture:** One shared prefix-resolution helper in `packages/core/src/search/query.ts` powers both the legacy-shortcut table and live `is:`/`has:` value abbreviation, entirely at parse time — `matchQuery`/`matchModifier` need no changes. A new `packages/core/src/search/suggest.ts` module provides pure, framework-agnostic suggestion logic reused by a new `SearchAutocomplete.tsx` component wired into `SearchBar.tsx` via new jotai atoms in `state.tsx`.

**Tech Stack:** TypeScript, Bun test runner, jotai/bunshi molecules (existing app state pattern), React.

---

## Before you start

Read `docs/superpowers/specs/2026-07-24-query-shortcuts-and-autocomplete-design.md` in full — in particular the Non-goals section explaining why the dropdown never suggests bare `is:`/`has:` field names before they're fully typed (only values, once the field prefix is complete).

---

### Task 1: Prefix resolution and legacy shortcuts in the parser

**Files:**
- Modify: `packages/core/src/search/query.ts`
- Test: `packages/core/src/__tests__/query.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/__tests__/query.test.ts` (after the closing `})` of the `firstPassInclude` describe block, i.e. at the end of the file):

```ts

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

describe("legacy bare shortcuts", () => {
  it("resolves :p to is:page", () => {
    expect(parseQuery(":p", ".")[0]).toEqual({ type: "modifier", field: "is", value: "page" })
  })

  it("resolves :e to has:emoji", () => {
    expect(parseQuery(":e", ".")[0]).toEqual({ type: "modifier", field: "has", value: "emoji" })
  })

  it("resolves :t to is:task, unambiguous even though is:text now exists", () => {
    expect(parseQuery(":t", ".")[0]).toEqual({ type: "modifier", field: "is", value: "task" })
  })

  it("resolves full legacy names too, e.g. :page and :header", () => {
    expect(parseQuery(":page", ".")[0]).toEqual({ type: "modifier", field: "is", value: "page" })
    expect(parseQuery(":header", ".")[0]).toEqual({ type: "modifier", field: "is", value: "header" })
  })

  it("falls back to a literal search for an unrecognized bare shortcut", () => {
    expect(parseQuery(":xyz", ".")[0]).toEqual({ type: "contains", value: ":xyz" })
  })

  it("negates a legacy shortcut like the new syntax", () => {
    expect(parseQuery("-:p", ".")[0]).toEqual({
      type: "not",
      expr: { type: "modifier", field: "is", value: "page" },
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/core/src/__tests__/query.test.ts`
Expected: FAIL — `is:t` currently resolves to a literal `"t"` value already (no change there yet, so that one test actually already passes), but `has:e`, `is:p`, `:p`, `:e`, `:t`, `:page`, `:header`, `-:p` all currently fail because there's no prefix resolution or legacy-shortcut handling yet (`:p` etc. currently parse as plain `contains(":p")`, not a modifier).

- [ ] **Step 3: Add prefix resolution and the legacy alias table to `query.ts`**

In `packages/core/src/search/query.ts`, add these new declarations right after the `QueryExpr` type definition (after line 12, before the `// ── Tokenizer ──` comment on line 14):

```ts

export const IS_VALUES = ["page", "header", "text", "folder", "attachment", "task"]
export const HAS_VALUES = ["emoji", "link", "page"]

const LEGACY_MODIFIERS: Record<string, { field: QueryModifierField; value: string }> = {
  page: { field: "is", value: "page" },
  header: { field: "is", value: "header" },
  folder: { field: "is", value: "folder" },
  attachment: { field: "is", value: "attachment" },
  task: { field: "is", value: "task" },
  emoji: { field: "has", value: "emoji" },
}

function resolveUniquePrefix(candidates: string[], typed: string): string | null {
  if (candidates.includes(typed)) return typed
  const matches = candidates.filter(c => c.startsWith(typed))
  return matches.length === 1 ? matches[0] : null
}
```

- [ ] **Step 4: Update `matchField` to resolve `is:`/`has:` values by prefix**

Replace (currently, after the constants added in Step 3, this function sits right before `parseTokens`):

```ts
function matchField(word: string): { field: QueryModifierField; value: string } | null {
  const m = /^(is|has):(.+)$/.exec(word)
  if (!m) return null
  return { field: m[1] as QueryModifierField, value: m[2] }
}
```

with:

```ts
function matchField(word: string): { field: QueryModifierField; value: string } | null {
  const m = /^(is|has):(.+)$/.exec(word)
  if (!m) return null
  const field = m[1] as QueryModifierField
  const typedValue = m[2]
  const values = field === "is" ? IS_VALUES : HAS_VALUES
  const resolved = resolveUniquePrefix(values, typedValue)
  return { field, value: resolved ?? typedValue }
}
```

- [ ] **Step 5: Add legacy bare-shortcut resolution and wire it into `parseAtom`**

Add this new function right after `matchField` (before `function parseTokens`):

```ts
function matchLegacyModifier(word: string): { field: QueryModifierField; value: string } | null {
  const m = /^:([a-z]+)$/.exec(word)
  if (!m) return null
  const resolved = resolveUniquePrefix(Object.keys(LEGACY_MODIFIERS), m[1])
  return resolved ? LEGACY_MODIFIERS[resolved] : null
}
```

Then replace `parseAtom`'s word-handling branch — currently:

```ts
    if (tok.kind === "word") {
      const field = matchField(tok.value)
      if (field) return { type: "modifier", field: field.field, value: field.value }
      return { type: "contains", value: tok.value }
    }
```

with:

```ts
    if (tok.kind === "word") {
      const field = matchField(tok.value)
      if (field) return { type: "modifier", field: field.field, value: field.value }
      const legacy = matchLegacyModifier(tok.value)
      if (legacy) return { type: "modifier", field: legacy.field, value: legacy.value }
      return { type: "contains", value: tok.value }
    }
```

Note: an ambiguous legacy prefix (2+ candidates) is not reachable with today's 6-name `LEGACY_MODIFIERS` table (no name is a prefix of another), so `matchLegacyModifier` returning `null` in practice only ever means "no name starts with this" — both cases correctly fall through to the same literal-`contains` fallback above, matching the pre-redesign parser's behavior for an unrecognized `:xyz`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test packages/core/src/__tests__/query.test.ts`
Expected: PASS — all tests green (20 original + 5 fixup-round tests + 10 new = 35... actual count may differ slightly; the important thing is 0 failures).

- [ ] **Step 7: Run the whole core package's tests to check for regressions**

Run: `bun test packages/core`
Expected: PASS — no regressions in `search.ts`/integration tests, since `matchQuery`/`matchModifier`/`firstPassInclude` signatures and behavior for already-valid `is:`/`has:` values are unchanged; only previously-unresolved/ambiguous inputs now resolve differently (to a real value instead of failing to match, or to a legacy modifier instead of literal text).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/search/query.ts packages/core/src/__tests__/query.test.ts
git commit -m "$(cat <<'EOF'
feat(core): resolve is:/has: values by unique prefix, restore legacy :x shortcuts

has:e now resolves to has:emoji when unambiguous; is:t stays
unresolved (ambiguous between task/text) and matches nothing, same
as an unrecognized value today. Bare shortcuts like :p/:e/:t are
resolved against a fixed 6-name legacy table (mirroring the
pre-redesign modifier list) and mapped onto their is:/has:
equivalent — :t stays unambiguous (task) since "text" was never
part of that old list.
EOF
)"
```

---

### Task 2: Suggestion logic module

**Files:**
- Create: `packages/core/src/search/suggest.ts`
- Test: `packages/core/src/__tests__/suggest.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test file**

Create `packages/core/src/__tests__/suggest.test.ts`:

```ts
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
      cursorPos: 16,
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/core/src/__tests__/suggest.test.ts`
Expected: FAIL with "Cannot find module '../search/suggest.ts'" (the file doesn't exist yet).

- [ ] **Step 3: Create `packages/core/src/search/suggest.ts`**

```ts
import { IS_VALUES, HAS_VALUES } from "./query.ts"

export type Suggestion = { label: string; insertText: string }

export function suggestAt(query: string, cursorPos: number): Suggestion[] {
  // The token immediately before the cursor is everything since the last
  // space (or the start of the string, if there is no earlier space).
  const before = query.slice(0, cursorPos)
  const tokenStart = before.lastIndexOf(" ") + 1
  const token = before.slice(tokenStart).toLowerCase()

  // Only a complete "is:x" or "has:x" token triggers suggestions — bare
  // letters or a leading ":" don't (see the design doc's Non-goals: bare
  // letters collide with normal search terms, and a leading ":" belongs
  // only to the legacy grammar, not this one).
  const match = /^(is|has):([a-z]*)$/.exec(token)
  if (!match) return []

  const [, field, typed] = match
  const values = field === "is" ? IS_VALUES : HAS_VALUES
  return values
    .filter(v => v.startsWith(typed) && v !== typed)
    .map(v => ({ label: `${field}:${v}`, insertText: `${field}:${v}` }))
}

export function spliceSuggestion(
  query: string,
  cursorPos: number,
  insertText: string
): { query: string; cursorPos: number } {
  const before = query.slice(0, cursorPos)
  const tokenStart = before.lastIndexOf(" ") + 1
  const after = query.slice(cursorPos)
  const newQuery = query.slice(0, tokenStart) + insertText + after
  return { query: newQuery, cursorPos: tokenStart + insertText.length }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/core/src/__tests__/suggest.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Export the new module from the package barrel**

In `packages/core/src/index.ts`, add this line directly after the existing `query.ts` export line (currently line 45, `export { parseQuery, matchQuery, firstPassInclude, containsEmoji as queryContainsEmoji, type QueryExpr, type QueryModifierField } from "./search/query.ts"`):

```ts
export { suggestAt, spliceSuggestion, type Suggestion } from "./search/suggest.ts"
```

- [ ] **Step 6: Run the whole core package's tests to check for regressions**

Run: `bun test packages/core`
Expected: PASS — no regressions (this task only adds new files and one new export line).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/search/suggest.ts packages/core/src/__tests__/suggest.test.ts packages/core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(core): add suggestAt/spliceSuggestion for is:/has: value autocomplete

Pure, framework-agnostic suggestion logic: suggestAt returns matching
values once a complete is:/has: field prefix is typed; spliceSuggestion
replaces the current token with an accepted suggestion. Exported from
the package barrel for the UI layer to consume.
EOF
)"
```

---

### Task 3: Autocomplete dropdown UI

**Files:**
- Create: `src/view/search/SearchAutocomplete.tsx`
- Modify: `src/view/react-context/state.tsx`
- Modify: `src/view/search/SearchBar.tsx`

None of these UI files have dedicated automated tests (same situation as the rest of `src/view/react-context/state.tsx` today), so this task is verified by type-checking and, if you have a running dev build available, manual interaction — see Step 6.

- [ ] **Step 1: Add suggestion-related atoms to `state.tsx`**

First, update the `@mdtree/core` import line near the top of `src/view/react-context/state.tsx` — currently:

```ts
import {advancedSearch, flattenTasks, ResultNode, searchIndex, searchParents, parseQuery, matchQuery, pruneResultTree, type QueryExpr, partitionArchived} from '@mdtree/core'
```

to:

```ts
import {advancedSearch, flattenTasks, ResultNode, searchIndex, searchParents, parseQuery, matchQuery, pruneResultTree, type QueryExpr, partitionArchived, suggestAt, type Suggestion} from '@mdtree/core'
```

Then, inside `SearchViewMolecule` (in `src/view/react-context/state.tsx`), find the `matchTermsAtom` definition followed by the molecule's `return { ... }` statement — currently:

```ts
    const matchTermsAtom = atom<string[]>((get) => {
        const query = get(actualQueryAtom)
        if (!query) return []
        const separator = get(separatorAtom)
        return parseQuery(query, separator).flatMap(extractTerms)
    })

    return {
            scopeName: {name: scp.name, instance: instance},
            actualQueryAtom,
            searchQueryAtom,
            searchResultsStateAtom,
            searchViewStateAtom,
            renderableTreeNodesAtom,
            incrementPagesAtom,
            hasMoreTreeNodesAtom,
            searchVisibleAtom,
            updateSearchResultsAtom,
            arrowUpAtom,
            arrowDownAtom,
            decExpandAtom,
            incExpandAtom,
            resetCollapseAtom,
            selectedNodeAtom,
            getExpandLevel,
            searchPlaceholderAtom,
            setDefaultExpandLevelAtom,
            expandNodeAtom, selectedLineAtom, updateHoveredLineAtom, hoveredLineAtom,
            matchTermsAtom
    }
})
```

Replace it with:

```ts
    const matchTermsAtom = atom<string[]>((get) => {
        const query = get(actualQueryAtom)
        if (!query) return []
        const separator = get(separatorAtom)
        return parseQuery(query, separator).flatMap(extractTerms)
    })

    const cursorPosAtom = atom(0)

    const rawSuggestionsAtom = atom<Suggestion[]>((get) => {
        const query = get(actualQueryAtom)
        const cursorPos = get(cursorPosAtom)
        return suggestAt(query, cursorPos)
    })

    const suggestionsDismissedAtom = atom(false)

    const suggestionsAtom = atom<Suggestion[]>((get) =>
        get(suggestionsDismissedAtom) ? [] : get(rawSuggestionsAtom)
    )

    const rawSuggestionIndexAtom = atom(0)

    const suggestionIndexAtom = atom(
        (get) => Math.min(get(rawSuggestionIndexAtom), Math.max(0, get(suggestionsAtom).length - 1)),
        (_get, set, index: number) => set(rawSuggestionIndexAtom, index)
    )

    const dismissSuggestionsAtom = atom(null, (_get, set) => set(suggestionsDismissedAtom, true))

    const resetSuggestionsAtom = atom(null, (_get, set) => {
        set(suggestionsDismissedAtom, false)
        set(rawSuggestionIndexAtom, 0)
    })

    return {
            scopeName: {name: scp.name, instance: instance},
            actualQueryAtom,
            searchQueryAtom,
            searchResultsStateAtom,
            searchViewStateAtom,
            renderableTreeNodesAtom,
            incrementPagesAtom,
            hasMoreTreeNodesAtom,
            searchVisibleAtom,
            updateSearchResultsAtom,
            arrowUpAtom,
            arrowDownAtom,
            decExpandAtom,
            incExpandAtom,
            resetCollapseAtom,
            selectedNodeAtom,
            getExpandLevel,
            searchPlaceholderAtom,
            setDefaultExpandLevelAtom,
            expandNodeAtom, selectedLineAtom, updateHoveredLineAtom, hoveredLineAtom,
            matchTermsAtom,
            cursorPosAtom, suggestionsAtom, suggestionIndexAtom, dismissSuggestionsAtom, resetSuggestionsAtom
    }
})
```

`suggestionIndexAtom` clamps to the current suggestion list's length so it's always valid even if the list shrinks as you type, without needing a separate reset effect. `resetSuggestionsAtom` (called whenever the query text changes) clears both the dismissed flag and the raw index back to 0, so a fresh keystroke always re-surfaces suggestions from the top.

- [ ] **Step 2: Type-check after the `state.tsx` change**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: Errors in `src/view/search/SearchBar.tsx` are expected at this point (it doesn't yet use the new atoms) — there should be **no** errors in `state.tsx` itself. If `state.tsx` itself has errors, stop and report them rather than continuing to Step 3.

- [ ] **Step 3: Create `src/view/search/SearchAutocomplete.tsx`**

```tsx
import React from "react";
import type { Suggestion } from "@mdtree/core";

export type SearchAutocompleteProps = {
    suggestions: Suggestion[]
    highlightedIndex: number
    onHover: (index: number) => void
    onAccept: (suggestion: Suggestion) => void
}

export const SearchAutocomplete = ({ suggestions, highlightedIndex, onHover, onAccept }: SearchAutocompleteProps) => {
    if (suggestions.length === 0) return null

    return (
        <div className="tw-reset absolute left-0 right-1 top-full mt-1 z-20 rounded-lg border bg-obs-base-0 shadow-lg overflow-hidden">
            {suggestions.map((s, i) => (
                <div
                    key={s.label}
                    className={`px-3 py-2 cursor-pointer text-sm font-mono ${i === highlightedIndex ? "bg-obs-hover" : ""}`}
                    onMouseEnter={() => onHover(i)}
                    onMouseDown={ev => { ev.preventDefault(); onAccept(s) }}
                >
                    {s.label}
                </div>
            ))}
        </div>
    )
}
```

(`onMouseDown` with `preventDefault` — not `onClick` — so the input doesn't blur/lose focus before the click is registered, a standard pattern for dropdown suggestion lists.)

- [ ] **Step 4: Wire it into `SearchBar.tsx`**

Replace the full contents of `src/view/search/SearchBar.tsx` with:

```tsx
import React from "react";
import {SEARCH_ICON, REFRESH_ICON} from "../icons";
import {useUrlOpener} from "./useUrlOpener";
import {useAtom, useAtomValue, useSetAtom} from "jotai";
import {useMolecule} from "bunshi/react";
import {GlobalAppMolecule, SearchViewMolecule} from "../react-context/state";
import {spliceSuggestion, type Suggestion} from "@mdtree/core";
import {SearchAutocomplete} from "./SearchAutocomplete";

export type SearchBarProps = {
    isQuickLink: boolean
}

export const SearchBar = ({ isQuickLink }: SearchBarProps) => {

    const { isGraphLoadingAtom, lastSearchAtom } = useMolecule(GlobalAppMolecule)
    const {
        decExpandAtom, incExpandAtom, resetCollapseAtom, searchQueryAtom, selectedNodeAtom, getExpandLevel,
        searchPlaceholderAtom, suggestionsAtom, suggestionIndexAtom, cursorPosAtom, dismissSuggestionsAtom,
        resetSuggestionsAtom,
    } = useMolecule(SearchViewMolecule)

    const decExpand = useSetAtom(decExpandAtom)
    const incExpand = useSetAtom(incExpandAtom)
    const resetCollapse = useSetAtom(resetCollapseAtom)
    const setLoading = useSetAtom(isGraphLoadingAtom)

    const handleRefresh = () => setLoading(true)

    const searchPlaceholder = useAtomValue(searchPlaceholderAtom)

    const expandLevel = useAtomValue(getExpandLevel)

    const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom)
    const saveLastSearch = useSetAtom(lastSearchAtom)

    const suggestions = useAtomValue(suggestionsAtom)
    const [suggestionIndex, setSuggestionIndex] = useAtom(suggestionIndexAtom)
    const [cursorPos, setCursorPos] = useAtom(cursorPosAtom)
    const dismissSuggestions = useSetAtom(dismissSuggestionsAtom)
    const resetSuggestions = useSetAtom(resetSuggestionsAtom)

    const setSearch = (search: string) => {
        setSearchQuery({ query: search })
        saveLastSearch({ query: search })
    }

    const updateCursor = (ev: React.SyntheticEvent<HTMLInputElement>) => {
        setCursorPos(ev.currentTarget.selectionStart ?? ev.currentTarget.value.length)
    }

    const acceptSuggestion = (suggestion: Suggestion) => {
        const spliced = spliceSuggestion(searchQuery.query, cursorPos, suggestion.insertText)
        setSearch(spliced.query)
        setCursorPos(spliced.cursorPos)
        resetSuggestions()
    }

    const handleKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
        if (suggestions.length === 0) return

        if (ev.key === "ArrowDown") {
            ev.preventDefault(); ev.stopPropagation()
            setSuggestionIndex((suggestionIndex + 1) % suggestions.length)
        } else if (ev.key === "ArrowUp") {
            ev.preventDefault(); ev.stopPropagation()
            setSuggestionIndex((suggestionIndex - 1 + suggestions.length) % suggestions.length)
        } else if (ev.key === "Tab") {
            ev.preventDefault(); ev.stopPropagation()
            acceptSuggestion(suggestions[suggestionIndex])
        } else if (ev.key === "Escape") {
            ev.preventDefault(); ev.stopPropagation()
            dismissSuggestions()
        }
    }

    const { linkRef, tryOpenUrl } = useUrlOpener()

    return <>
        <a style={{ display: "none" }} target="_blank" ref={linkRef} href="#"></a>
    <div className="tw-reset sticky top-0 z-10">

        <div className="relative flex items-center flex-1">
            <div className="flex items-center justify-between w-full max-w-4xl">
                <div className="relative flex-1">
                    <input
                        enterKeyHint="search"
                        type="search"
                        spellCheck="false"
                        onChange={ev => { setSearch(ev.target.value); resetSuggestions(); updateCursor(ev) }}
                        onKeyDown={handleKeyDown}
                        onClick={updateCursor}
                        onKeyUp={updateCursor}
                        value={searchQuery.query}
                        placeholder={searchPlaceholder}
                        className="w-full pl-5 ml-1 mb-2 mt-2 pr-16 py-3
                        rounded-lg border focus:border-obs-hover hover:border-obs-hover focus:ring-0
                        outline-none transition-all duration-150
                        bg-obs-base-0
                        "
                    />

                    <SearchAutocomplete
                        suggestions={suggestions}
                        highlightedIndex={suggestionIndex}
                        onHover={setSuggestionIndex}
                        onAccept={acceptSuggestion}
                    />

                    <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center space-x-1">
                        <button
                            className="text-obs-base-40 focus:outline-none hover:text-obs-accent bg-transparent border-none p-1"
                            aria-label="Search"
                            onClick={() => {/* Search action can be added here if needed */}}
                        >
                            <SEARCH_ICON />
                        </button>

                        <button
                            className="text-obs-base-40 focus:outline-none hover:text-obs-accent bg-transparent border-none p-1"
                            aria-label="Clear search"
                            onClick={() => setSearch("")}
                        >
                            ×
                        </button>
                    </div>
                </div>

                <div className="ml-2 flex items-center space-x-1">
                    <button className="bg-transparent border-none p-1 text-obs-base-40 hover:text-obs-accent focus:outline-none clickable-icon" aria-label="Collapse results" onClick={decExpand}>-</button>
                    <button className="bg-transparent border-none p-1 text-obs-base-40 hover:text-obs-accent focus:outline-none clickable-icon" aria-label="Collapse to zero" onClick={resetCollapse}> {expandLevel} </button>
                    <button className="bg-transparent border-none p-1 text-obs-base-40 hover:text-obs-accent focus:outline-none clickable-icon" aria-label="Expand results" onClick={incExpand}>+</button>
                    <button className="bg-transparent border-none p-1 text-obs-base-40 hover:text-obs-accent focus:outline-none clickable-icon" aria-label="Refresh Tree" onClick={handleRefresh}>
                        <REFRESH_ICON />
                    </button>
                </div>
            </div>
            
        </div>
        
    </div>
    </>
} 
```

This preserves every existing behavior (refresh, expand/collapse, clear, placeholder) unchanged and adds: cursor-position tracking (`onClick`/`onKeyUp`/`onChange`), the suggestions dropdown rendered right under the input, and keyboard handling that only intercepts `ArrowDown`/`ArrowUp`/`Tab`/`Escape` — and only while `suggestions.length > 0` — via `event.stopPropagation()`. When there are no suggestions, `handleKeyDown` returns immediately without calling `preventDefault`/`stopPropagation`, so `ArrowUp`/`ArrowDown`/`Enter` continue to bubble up to `KeyComboWrapper.tsx`'s existing handler exactly as today.

- [ ] **Step 5: Type-check the whole project**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: No errors.

- [ ] **Step 6: Manual verification (no automated test infra at this layer)**

If you have the plugin running in a dev Obsidian vault (see the `run` skill or this repo's dev workflow), open the search modal and check:
- Typing `is:` shows a dropdown with all six `is:` values (`page`, `header`, `text`, `folder`, `attachment`, `task`).
- Typing `is:t` shows exactly two suggestions (`is:text`, `is:task`).
- Pressing `ArrowDown`/`ArrowUp` moves the highlight between them; pressing `Tab` inserts the highlighted one and moves the cursor past it.
- Pressing `Escape` closes the dropdown without changing the query text; typing another character reopens it if still applicable.
- Clicking a suggestion with the mouse inserts it the same way `Tab` does.
- With the dropdown closed, `ArrowUp`/`ArrowDown`/`Enter` still navigate/activate search results exactly as before this change.

If no dev vault is available in your environment, note this in your task report rather than skipping verification silently — the type-check in Step 5 is necessary but not sufficient to confirm the interaction actually works.

- [ ] **Step 7: Commit**

```bash
git add src/view/search/SearchAutocomplete.tsx src/view/react-context/state.tsx src/view/search/SearchBar.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add autocomplete dropdown for is:/has: search values

Typing a complete is:/has: field prefix shows matching values in a
dropdown under the search box. Tab accepts the highlighted suggestion,
Escape dismisses it, arrow keys navigate it — all without changing
ArrowUp/ArrowDown/Enter's existing meaning once the dropdown is closed.
EOF
)"
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `bun test`
Expected: All tests pass, aside from the pre-existing, unrelated failure in the untracked `packages/cli/src/__tests__/crew-package-integration.test.ts` file (a stray file from a different tool, not part of this codebase's tracked source — ignore it if present).

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: No errors.

- [ ] **Step 3: Spot-check the design doc's core examples directly**

Using a scratch script or `bun run packages/cli/src/main.ts query <vault-dir> "<query>"` against any vault, confirm:
- `:p` behaves like `is:page`.
- `has:e` behaves like `has:emoji`.
- `is:t` matches nothing (ambiguous).

If no vault is handy, this can be satisfied by re-confirming the relevant `query.test.ts`/`suggest.test.ts` assertions from Tasks 1–2 pass — note in your report which method you used.

No commit for this task — it's verification of work already committed in Tasks 1–3. If any step surfaces a problem, fix it in the relevant task's files and create a new commit for the fix.
