# Archive as a Query-Time Visibility Flag

## Problem

"Archive" today is **three unrelated mechanisms** wearing one name, and none of them can be
*revealed* once hidden:

| # | Mechanism | Where | When | Effect |
|---|-----------|-------|------|--------|
| 1 | Page frontmatter `#archive` | `graph/indexer.ts:218-261` | index time | page body never indexed |
| 2 | Line `#archive` tag (`shouldSkip`) | `graph/indexer.ts:27,270` | index time | line + subtree never indexed |
| 3 | `(meta-mdtree:: archive)` directive | `search/archive.ts` (`partitionArchived`) | query time | node + subtree dropped from results, shown as a count |

Mechanisms 1 & 2 *delete* archived content from the index, so it is gone — unrecoverable. Mechanism 3
hides-with-a-count at query time. There is no way to say "show me my archived items"; the content
either was never indexed or is silently dropped.

Separately, a grey/dim visual state already exists (`ts-node-dim`), but it means "structural context,
not a query hit" — **not** "archived".

## Proposal

Unify the three mechanisms into a single notion of **archived**, and turn archive from an *index-time
exclusion* into a *query-time visibility flag*:

- An archived item and everything beneath it is **archived** (propagation is path-contextual — see
  Design).
- Archived content is **indexed** (no longer discarded), so it can be revealed.
- By default, anything archived that matches a query is **hidden** (as mechanism 3 does today, but now
  covering all three authoring forms).
- Providing `is:archived` (or legacy `:archived`) **reveals** the archived items, rendered **grayed
  out** with a distinct style (not the existing context-dim).

```
   TODAY                                YOUR MODEL
   ─────                                ──────────
   3 archive mechanisms                 1 notion: node.archived (derived)
   index-time exclusion (1,2)           always indexed, tagged, filtered at query time
   is:archived finds nothing            is:archived flips hide → reveal-grey
```

### `is:archived` is a reveal toggle, not a matcher

Every other modifier is a matcher ANDed into the query. `is:archived` can't be — as a matcher,
`foo is:archived` would mean "foo AND archived" = *only* archived foo. The requirement is that archived
items appear **alongside** normal results (greyed), so `is:archived` is extracted from the query and
turned into a `reveal` flag, with one degradation rule so a bare flag still works:

```
1. Extract every is:archived / :archived  →  reveal = true, remove from the expr tree.
2. Per stage: if removal leaves the stage EMPTY, substitute the archived predicate as its matcher.
3. Feed reveal into partitionArchived (keep instead of drop; count only when hiding).

  foo is:archived        → "foo AND archived" → strip → "foo"          (reveal) → foo hits + archived revealed grey
  is:archived            → "archived"         → strip → ∅ → "archived"  (reveal) → only archived, grey
  projectX . is:archived → stage 2 strip → ∅ → "archived"              (reveal) → archived under projectX
```

## Scope

### Derived intrinsic flag (index time)

Normalize all three authoring forms — page frontmatter `#archive`, line `#archive` tag, and
`(meta-mdtree:: archive)` — into one derived `archived: boolean` on the node. Authoring syntax is
unchanged (users keep typing what they type today); `archived` is internal, derived state. Stop
excluding archived content at index time (`indexSinglePage` no longer returns `undefined`;
`shouldSkip` no longer skips on the archive tag).

### Effective (path-contextual) flag (build time)

`buildTree` carries `ancestorArchived` down each path and stamps
`effectiveArchived = intrinsic || ancestorArchived` on every `ResultNode`. This must happen **during
tree construction** because `pruneResultTree` can promote a matching descendant past an archived
ancestor — re-deriving archived-ness from ancestry *after* pruning would leak hidden items through.

### Visibility (query time)

`partitionArchived(results, reveal)`:
- `reveal = false` → drop `effectiveArchived` subtrees, return `archivedCount` (unchanged behavior,
  now covering all three forms). Keep the synthetic "Archive (N items)" affordance.
- `reveal = true` → keep archived subtrees, `archivedCount = 0`, no synthetic node.

### Rendering

`flatten` sets `TreeNode.archived = effectiveArchived`. `SearchTreeNode` applies a distinct
`ts-node-archived` class that **composes** with the existing `ts-node-dim` (a node can be both
archived and unmatched-context).

## Key Files

| File | Change |
|------|--------|
| `packages/core/src/graph/indexer.ts` | Stop excluding archived at index time; derive `node.archived` from the 3 forms |
| `packages/core/src/graph/types.ts` | Add `archived?: boolean` to node types (or a shared field) |
| `packages/core/src/search/search.ts` | `buildTree` carries `ancestorArchived`, stamps `effectiveArchived` on `ResultNode` |
| `packages/core/src/search/archive.ts` | `partitionArchived(results, reveal)`; key off `effectiveArchived` |
| `packages/core/src/search/query.ts` | Add `archived` to `IS_VALUES` + legacy map; `extractArchiveReveal()` (reveal + per-stage substitution) |
| `packages/core/src/search/syntax.ts` | Cheat-sheet entry + description for `is:archived` |
| `packages/core/src/search/flatten.ts` | Add `archived` to `TreeNode` from `effectiveArchived` |
| `src/view/SearchTreeNode.tsx` + `.css` | `ts-node-archived` style, composes with `ts-node-dim` |
| Call sites: `packages/cli/src/server/server.ts`, `packages/cli/src/commands/query.ts`, `src/view/react-context/state.tsx`, `src/view/markdown-code-block/InlineMarkdownResults.tsx`, `src/view/raycast/raycast-server.ts` | Thread the parsed `reveal` flag into `partitionArchived` |

## Non-goals

- **No new authoring syntax.** `archived: true` is the derived internal flag, not something users
  type; the three existing authoring forms are the source of truth.
- **No cross-file reference inheritance semantics beyond path-contextual.** Archived-ness is judged per
  occurrence in the result tree, not globally per node.
- **No change to `is:`/`has:`/`in:` matching** other than adding `archived`.
- Clickable "Archive (N) → add is:archived" affordance on the synthetic node is a nice-to-have, not
  required here.

## Success Criteria

- An archived item and all its descendants are hidden by default across all three authoring forms
  (page frontmatter, line tag, directive), including when a matching descendant would otherwise be
  promoted to a result root.
- `is:archived` / `:archived` reveals archived items rendered with the distinct `ts-node-archived`
  style, alongside normal (bright) results.
- Bare `is:archived` surfaces only the archived items (grey).
- `foo is:archived` shows foo hits (bright) plus archived foo (grey); `projectX . is:archived` shows
  archived under projectX.
- Archived content is present in the index (verifiable: a query with `is:archived` returns items a
  query without it hides).
- Existing `archive.test.ts` / `reindex-archive.test.ts` expectations are migrated from
  "excluded/absent" to "hidden-but-revealable".
