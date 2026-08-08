# Design — Archive as a Query-Time Visibility Flag

## Decision 1: One derived intrinsic flag, three authoring forms

Authoring stays as-is; the parser/indexer normalizes into a single derived boolean.

```
page frontmatter #archive  ─┐
line #archive tag           ├─►  node.archived = true   (derived, internal)
(meta-mdtree:: archive)    ─┘
```

- `indexSinglePage` no longer `return undefined`s for frontmatter-archived pages — it indexes the
  body and sets `archived` on the page node.
- `shouldSkip` no longer skips on the archive tag — the line is indexed with `archived = true`. (Its
  other skip rules — `--header--` wrappers, plain-text lines — are unchanged.)
- The `(meta-mdtree:: archive)` directive is still detectable via `parsedTokens`; `isArchived(node)`
  becomes a read of the derived flag rather than a token scan, so all three forms flow through one
  predicate.

**Why:** the answer to "how is archived authored" was *derived flag, keep existing syntax*. This keeps
every current vault working untouched while giving downstream code exactly one thing to test.

## Decision 2: Path-contextual, computed during `buildTree` (the load-bearing decision)

`ResultNode.children` is built from **graph edges** (`search.ts` `outboundEdgeEntries`), which include
cross-file **reference** edges — not just outline containment. So the same node can appear under an
archived parent and a non-archived parent. Archived-ness is therefore a property of a **path**, not a
node.

```
- ProjectX (archived)          - Inbox (not archived)
    └─ note foo  ◄────────────────── note foo   (same node, two parents)
       archived HERE                 not archived HERE
```

A precomputed "stamp archived on all descendants" pass would be ambiguous over reference edges — hence
**path-contextual**. But it cannot be re-derived *after* the pipeline, because:

```
searchIndex = buildTree → filterDown → pruneResultTree
                                          │
   pruneResultTree can "drop node, promote kept descendants" (search.ts:81)
   → an archived ANCESTOR is deleted and a matching descendant becomes a root.
   → a post-hoc ancestry check sees no archived ancestor → item leaks through. ❌
```

So `effectiveArchived` is stamped **while the tree is built**, when the full path is still known, and
survives promotion:

```ts
function buildTree(nodeKey, graph, roots, traversed, ancestorArchived = false): ResultNode {
  const intrinsic = isArchived(attrs)                 // derived flag (Decision 1)
  const effectiveArchived = intrinsic || ancestorArchived
  // ...children built with ancestorArchived = effectiveArchived
  return { node, children, effectiveArchived }
}
```

`pruneResultTree` / `filterDown` already spread `...node`, so the flag rides along through promotion
for free.

## Decision 3: `is:archived` is a reveal toggle, extracted from the query

`is:archived` is added to `IS_VALUES` (and to the legacy map for `:archived`) so it *parses* and
*autocompletes* like a normal modifier — but it is pulled out before matching and converted into a
`reveal` flag.

```ts
// packages/core/src/search/query.ts
export function extractArchiveReveal(stages: QueryExpr[]): { reveal: boolean; stages: QueryExpr[] } {
  // 1. walk each stage, remove {modifier, is/legacy, "archived"} nodes → reveal = true if any found
  // 2. if a stage collapses to {type:"empty"}, replace it with the archived predicate
  //    (so a bare `is:archived` degrades from "toggle" to "match archived")
}
```

Truth table:

| Query | Base after strip | reveal | Result |
|-------|------------------|--------|--------|
| `foo is:archived` | `foo` | true | foo hits (bright) + archived foo revealed (grey) |
| `is:archived` | ∅ → `archived` | true | only archived (grey) |
| `projectX . is:archived` | stage2 ∅ → `archived` | true | archived under projectX |
| `foo` | `foo` | false | foo hits; archived hidden with count |

`reveal` is **global** to the search (a single visibility mode); the per-stage substitution in step 2
is what makes a stage that *only* said `is:archived` still find something. Negation `-is:archived` is
a no-op (archived is already hidden by default) and is simply stripped.

**Why toggle, not predicate:** the requirement — archived items "appear grayed out" — describes them
showing up *next to* normal results, not replacing them. A plain matcher (`foo AND archived`) would
hide non-archived hits, contradicting that.

## Decision 4: Two independent grey axes that compose

`matched` (query hit vs. context) and `archived` (in an archived subtree) are orthogonal. Both dim, but
for different reasons, so they get different classes and are allowed to stack.

```
                 matched=true            matched=false
 archived=false  (bright)                ts-node-dim         ← today's only two states
 archived=true   ts-node-archived        ts-node-dim + ts-node-archived
```

`SearchTreeNode.tsx`:

```ts
const dimClass = props.node.matched ? "" : "ts-node-dim"
const archivedClass = props.node.archived ? "ts-node-archived" : ""
// className = `... ${dimClass} ${archivedClass}`
```

`ts-node-archived` should be visually distinct from a plain context-dim (e.g. reduced opacity +
strikethrough or an archive glyph) so "archived" reads differently from "just context". Exact
treatment TBD in implementation against the live theme (light + dark).

## Decision 5: The synthetic "Archive (N items)" node

- `reveal = false` and `archivedCount > 0` → keep the synthetic count node (it is the discovery
  affordance for the flag). Optionally reword to hint `is:archived`, and/or make it click-to-insert
  the flag (nice-to-have, not required).
- `reveal = true` → no synthetic node; archived items are shown inline (grey) and `archivedCount = 0`.

## Risks

- **Index growth.** Previously-discarded archived subtrees (hard-excluded page bodies + `#archive`
  lines) are now indexed. On vaults with large archives this is the one real cost; everything else is
  cheap. Watch index size / build time in a big vault before shipping.
- **Test migration.** `archive.test.ts` and `reindex-archive.test.ts` currently assert archived
  content is *absent from the index*. Those flip to *present-but-hidden, revealable via reveal=true*.
  Review their current assertions first so the migration is intentional, not accidental.
- **Promotion regression.** Add a targeted test: archived ancestor + matching descendant that
  `pruneResultTree` promotes to a root → still hidden when `reveal=false`, shown grey when
  `reveal=true`. This is the case a naive implementation gets wrong.
