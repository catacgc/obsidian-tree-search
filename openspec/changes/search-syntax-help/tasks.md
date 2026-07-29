# Tasks — Search Syntax Help

## Core: self-describing grammar

- [x] Add `packages/core/src/search/syntax.ts` with `QuerySyntaxEntry`, `QuerySyntaxGroup`, and
      `describeQuerySyntax()`.
- [x] Generate the `is:` / `has:` groups from `IS_VALUES` / `HAS_VALUES` via a description map;
      hand-write Text, Recency (`in:` presets), Combine, and Legacy groups.
- [x] Mark only concrete tokens with `insertText` (is/has/in-presets/legacy); leave Text and Combine
      entries without it.
- [x] Export `describeQuerySyntax` + types from `packages/core/src/index.ts`.
- [x] Add drift-guard tests: (a) every `IS_VALUES`/`HAS_VALUES` value appears once with a non-empty
      description; (b) every `insertText` re-parses via `parseQuery` to the expected modifier.

## Plugin: insert plumbing

- [x] Add an append/set insert action on `searchQueryAtom` and a write-only "focus request" atom in
      `SearchViewMolecule` (`src/view/react-context/state.tsx`).
- [x] In `SearchBar.tsx`, hold an input `ref` and a `useEffect` on the focus atom that focuses the
      input and moves the cursor to the end.

## Plugin: SearchHelp component

- [x] Add `src/view/search/SearchHelp.tsx`: render groups from `describeQuerySyntax()`, buttons for
      `insertText` entries (calling the insert action), static spans otherwise.
- [x] Header logic: `trim().length < 3` → `Search syntax`; else → `No results for "<query>"`.
- [x] Style with Tailwind + `--obs-*` variables to match the existing panel; verify light + dark.
- [x] Render `<SearchHelp/>` from `SearchViewFlatten.tsx` in the `!isLoading &&
      renderableNodes.length === 0` branch (idle and no-match both covered).

## Verification

- [x] `npm test` — core drift-guard tests pass; existing suites unaffected. (218 pass / 0 fail)
- [x] `npm run build` — `tsc -noEmit` + esbuild clean.
- [ ] Manual (Obsidian, `npm run dev`): empty box shows `Search syntax` card; `zzz` shows
      `No results for "zzz"` + card; clicking `is:task` appends and focuses; grammar entries are not
      clickable; looks right in light and dark themes. *(requires running Obsidian — pending user)*
