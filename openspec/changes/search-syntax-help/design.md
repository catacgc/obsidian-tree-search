# Design — Search Syntax Help

## Decision 1: Self-describing grammar in core (not hardcoded React)

The cheat sheet is generated from a single source of truth in `@mdtree/core` so it cannot drift from
what the parser accepts.

```ts
// packages/core/src/search/syntax.ts
export type QuerySyntaxEntry = {
  syntax: string          // display form, e.g. "is:task" or "a . b"
  description: string     // human text, e.g. "tasks" / "find a, then b beneath it"
  insertText?: string     // present ⇒ clickable launcher; absent ⇒ static illustration
}
export type QuerySyntaxGroup = { title: string; entries: QuerySyntaxEntry[] }

export function describeQuerySyntax(): QuerySyntaxGroup[]
```

- The **Type (`is:`)** and **Content (`has:`)** groups are built by mapping over `IS_VALUES` /
  `HAS_VALUES` (from `query.ts`) and looking up a description in a local `Record<string,string>`.
- **Recency (`in:`)** presets (`7d`/`2w`/`1m`/`1y`) and **Legacy** shortcuts reference the same units
  / `LEGACY_MODIFIERS` the parser uses.
- **Text** and **Combine** groups are static entries with **no** `insertText` (they are templates,
  not literal tokens).

**Why:** the recent "guard IS_VALUES/HAS_VALUES against drift" work established that these enums are
the contract. Deriving help from them extends that contract to the docs. Bonus: reusable for a future
`mdtree query --help` and README generation.

### Drift guard (test)

- Every value in `IS_VALUES` and `HAS_VALUES` appears **exactly once** across
  `describeQuerySyntax()` with a non-empty `description`.
- Every entry that has `insertText` re-parses via `parseQuery(insertText)` to the modifier it claims
  to represent (e.g. `is:task` → `{type:"modifier", field:"is", value:"task"}`), so the launchers
  can't advertise tokens the parser wouldn't accept.

## Decision 2: Clickable vs illustrative split

Only concrete, literally-insertable tokens carry `insertText`:

```
insertText set   → is:*  has:*  in:{7d,2w,1m,1y}  :page :header :folder :attachment :task :emoji
insertText unset → foo   "foo bar"   a b   a | b   -a   (a | b) c   a . b
```

Rendering keys off presence of `insertText`: `<button>` vs `<span>`. This keeps the grammar patterns
(which contain placeholder operands `a`/`b`) from being inserted as literal nonsense.

## Decision 3: Insert = append, then focus

```
click token T with current query Q:
  Q is empty/whitespace  →  setQuery(T)
  else                   →  setQuery(Q.trimEnd() + " " + T)
  then: focus the search <input>, cursor at end
```

Append ("add a filter") beats splice-at-cursor here: in the no-match state the user has typed
something meaningful (`zzz`), and `spliceSuggestion` would replace that trailing token. The existing
`spliceSuggestion` path stays owned by the autocomplete; the help panel uses a simpler append.

### Focus handoff

`SearchHelp` and the `<input>` are siblings, so focusing needs a channel:

- Add a small write-only "focus request" atom (e.g. a counter/nonce) in `SearchViewMolecule`.
- The insert handler bumps it after setting the query.
- `SearchBar` holds a `ref` to the input and a `useEffect` on that atom that calls `inputRef.current?.focus()` and moves the cursor to the end.

This avoids threading a ref across the tree and matches the app's jotai-atom-driven style.

## Decision 4: Zero-state header logic

```
trimmed = query.trim()
if (trimmed.length < 3)  → header "Search syntax"        (idle / keep typing)
else                     → header `No results for "…"`   (real miss)
```

Below-minimum queries (1–2 chars) are treated as idle rather than a "miss", since `searchIndex`
returns `[]` purely due to the 3-char minimum, not a genuine no-match.

## Component sketch

```
<SearchHelp>
  <header>{trimmed.length<3 ? "Search syntax" : `No results for "${trimmed}"`}</header>
  <div class="grid">
    {describeQuerySyntax().map(group =>
      <section>
        <h4>{group.title}</h4>
        {group.entries.map(e =>
          e.insertText
            ? <button onClick={()=>onInsert(e.insertText)}><code>{e.syntax}</code> {e.description}</button>
            : <div><code>{e.syntax}</code> {e.description}</div>
        )}
      </section>
    )}
  </div>
</SearchHelp>
```
