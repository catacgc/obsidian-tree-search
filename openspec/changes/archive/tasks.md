# Tasks — Archive as a Query-Time Visibility Flag

## Core: derived intrinsic flag

- [x] Add `archived?: boolean` to the node type(s) in `packages/core/src/graph/types.ts`.
- [x] In `graph/indexer.ts`: set `archived = true` on the page node when frontmatter carries the
      archive tag, and **stop** `return undefined` — index the body.
- [x] In `graph/indexer.ts` `shouldSkip`: stop skipping on the archive tag; instead mark the created
      node `archived = true` (keep the `--header--` and plain-text skip rules).
- [x] Detect the `(meta-mdtree:: archive)` directive at index time and set `archived = true` too.
- [x] Rewrite `isArchived(node)` in `search/archive.ts` to read the derived flag (all three forms flow
      through one predicate).

## Core: effective (path-contextual) flag

- [x] Add `effectiveArchived: boolean` to `ResultNode` (`search/search.ts`).
- [x] Thread `ancestorArchived` through `buildTree`; stamp `effectiveArchived = intrinsic ||
      ancestorArchived` on each node; recurse with `ancestorArchived = effectiveArchived`.
- [x] Confirm `filterDown` / `pruneResultTree` spread the flag through promotion (`...node`).

## Core: query extraction

- [x] Add `archived` to `IS_VALUES` and the legacy modifier map in `search/query.ts`.
- [x] Add `matchModifier` case for `is:archived` → matches `effectiveArchived` (used by the per-stage
      substitution and by `nodeMatchesQuery` for the `matched` flag).
- [x] Add `extractArchiveReveal(stages)` → `{ reveal, stages }`: remove archived modifiers (set
      `reveal`); replace any stage that collapses to `empty` with the archived predicate.
- [x] Add a cheat-sheet entry + description for `is:archived` in `search/syntax.ts` (keep the
      drift-guard test green).

## Core: visibility + flatten

- [x] `partitionArchived(results, reveal)`: key off `effectiveArchived`; `reveal=false` drops +
      counts, `reveal=true` keeps with `archivedCount = 0`.
- [x] Add `archived: boolean` to `TreeNode` in `search/flatten.ts`, set from `effectiveArchived`.
- [x] Export any new symbols from `packages/core/src/index.ts`.

## Call sites: thread reveal

- [x] `packages/cli/src/server/server.ts` — parse, `extractArchiveReveal`, pass `reveal`.
- [x] `packages/cli/src/commands/query.ts` — same.
- [x] `src/view/react-context/state.tsx` — same (main plugin search path).
- [x] `src/view/markdown-code-block/InlineMarkdownResults.tsx` — same.
- [x] `src/view/raycast/raycast-server.ts` — same.

## Plugin: rendering

- [x] `src/view/SearchTreeNode.tsx` — add `archivedClass` from `node.archived`, compose with
      `dimClass`.
- [x] `src/view/SearchTreeNode.css` — `ts-node-archived` distinct from `ts-node-dim`; verify light +
      dark.
- [ ] (Optional, not done) reword / make clickable the synthetic "Archive (N items)" node to insert
      `is:archived`.

## Tests

- [x] Migrate `archive.test.ts` + `reindex-archive.test.ts`: archived content is now *indexed and
      hidden*, not *absent*; add `reveal=true` cases showing it returns.
- [x] Path-contextual: same node under archived + non-archived parents → archived only under the
      archived path.
- [x] **Promotion regression**: archived ancestor + matching descendant promoted by
      `pruneResultTree` → hidden when `reveal=false`, shown (grey) when `reveal=true`.
- [x] Extraction: `foo is:archived`, bare `is:archived`, `projectX . is:archived`, `-is:archived`
      each produce the expected `{ reveal, stages }`.

## Verification

- [x] `npm test` — all suites pass.
- [x] `npm run build` — `tsc -noEmit` + esbuild clean.
- [ ] Index-size / build-time check on a large vault with a big archive (the one real cost).
- [ ] Manual (Obsidian, `npm run dev`): archived hidden by default; `is:archived` reveals grey;
      bare `is:archived` shows only archived; archived + unmatched compose visually; light + dark.
- [ ] CLI (`mdtree query`): re-index the real vault first (per memory), then confirm `is:archived`
      surfaces archived items a plain query hides.
