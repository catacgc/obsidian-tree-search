# meta-mdtree Archive — Design Spec

## Problem

Search results in mdtree can become cluttered with nodes the user no longer cares about but doesn't want to delete from their vault. There's no way to hide a subtree from results without removing the underlying content.

## Solution

A new inline Dataview property `(meta-mdtree:: archive)` that marks a node and its entire subtree as archived. Archived subtrees are removed from search results and replaced with a static "Archive (N items)" indicator at the bottom. Indexing is unaffected — archived content remains in the graph for linking and other purposes.

## Syntax

```markdown
- node1 (meta-mdtree:: archive)
  - child 1
    - child 2
```

The annotated node and all its descendants are hidden from search results. The property follows the existing Dataview inline syntax: `(key:: value)`.

## Parsing & Storage

### list-scanner.ts

New regex `META_MDTREE_RE` matches `(meta-mdtree::\s*archive)`. Applied alongside the existing `META_ACTION_RE`:

- Stripped from display `text` (same as meta-actions)
- Preserved in `rawText` for token extraction

### inline-tokens.ts

`parseTokens()` extracts `meta-mdtree` properties before markdown-it parsing (same pattern as meta-actions). Produces a new token type:

```ts
{ tokenType: "meta_mdtree", directive: "archive" }
```

Using `directive` rather than a boolean makes this extensible for future `meta-mdtree` values.

### types.ts

New type added to the `ParsedTextToken` union:

```ts
type MetaMdtreeToken = {
  tokenType: "meta_mdtree"
  directive: string
}
```

### Graph storage

No new fields on `TextNode`. The token lives in `parsedTokens` alongside other inline tokens. A helper function provides the check:

```ts
// packages/core/src/search/archive.ts
function isArchived(node: ParsedNode): boolean
```

Returns `true` if the node is a `TextNode` whose `parsedTokens` contain a `meta_mdtree` token with `directive === "archive"`.

## Post-search partition (Approach C)

### packages/core/src/search/archive.ts

```ts
function partitionArchived(
  results: ResultNode[]
): { visible: ResultNode[], archivedCount: number }
```

- Walks `ResultNode[]` recursively
- When `isArchived(node.node)` is true: removes the subtree from results, adds 1 + descendant count to `archivedCount`
- Non-archived nodes pass through with children recursively filtered
- Pure function, no side effects

Called between `searchIndex()` and flattening/rendering in all consumers.

## Consumers

### Plugin (src/view/react-context/state.tsx)

1. Call `partitionArchived(results)` after `searchIndex()`, before `flattenIndex()`
2. Pass `visible` to flattening as today
3. When `archivedCount > 0`, append a synthetic `TreeNode` at the end: "Archive (N items)" — static, non-expandable, non-interactive, dimmed style

### CLI server (packages/cli/src/server/response.ts)

1. Call `partitionArchived()` before building the response
2. Add `archivedCount` field to the JSON response
3. Raycast extension renders "Archive (N)" as a non-actionable item at the bottom

### CLI query subcommand

1. Same partition call
2. Plain text output: appends `Archive (N items)` as last line when count > 0
3. JSON output: `archivedCount` as a top-level field alongside `results` (e.g. `{ "results": [...], "archivedCount": 3 }`)

## Raycast Actions

### Archive action

- Shown for `text` nodes that do NOT have a `meta_mdtree` archive token
- URI: `obsidian://tree-search-uri?raycastaction=archive&vault=...&filepath=...&line=...`
- Handler appends ` (meta-mdtree:: archive)` to the end of the target line
- Reindex triggered by existing debounced `reindexFileInGraph`

### Unarchive action

- Shown for `text` nodes that DO have a `meta_mdtree` archive token
- URI: `obsidian://tree-search-uri?raycastaction=unarchive&vault=...&filepath=...&line=...`
- Handler removes `(meta-mdtree:: archive)` substring from the line, trims trailing whitespace
- Same reindex trigger

### Placement

Both actions placed after default actions (See in Obsidian, Copy, Insert After). No keyboard shortcut assigned.

## Copy / Reverse Markdown

`packages/core/src/search/copy.ts`: new case for `meta_mdtree` token reconstructs as `(meta-mdtree:: archive)` to preserve the annotation on copy-paste.

## Testing

### Unit tests — packages/core/src/__tests__/archive.test.ts

- `partitionArchived`: no archived nodes returns all visible with count 0
- `partitionArchived`: root-level archived node removed with full subtree count
- `partitionArchived`: nested archived node — parent stays, subtree pruned
- `partitionArchived`: multiple archived nodes at different levels
- `isArchived`: positive and negative cases

### Parser tests — packages/core/src/__tests__/indexer.test.ts

- `meta_mdtree` token parsed and stored in `parsedTokens`
- `searchKey` does not contain the annotation text

### Integration test — packages/core/src/__tests__/integration/fixtures/archive/

- `.md` files containing archived nodes
- Verify `searchIndex()` returns them (search unaware of archive)
- Verify `partitionArchived()` separates them correctly

### Action tests — src/view/__tests__/node-actions.test.ts

- Archive action appears for non-archived text nodes
- Unarchive action appears for archived text nodes
- Neither appears for non-text node types

## Files changed

| File | Change |
|------|--------|
| `packages/core/src/parser/list-scanner.ts` | Add `META_MDTREE_RE`, strip from text |
| `packages/core/src/parser/inline-tokens.ts` | Extract `meta_mdtree` tokens |
| `packages/core/src/graph/types.ts` | Add `MetaMdtreeToken` to union |
| `packages/core/src/search/archive.ts` | New: `isArchived`, `partitionArchived` |
| `packages/core/src/search/copy.ts` | Add `meta_mdtree` case |
| `src/view/react-context/state.tsx` | Call partition, append synthetic archive node |
| `src/view/node-actions.ts` | Archive/Unarchive actions |
| `src/view/react-context/actions.tsx` | URI handler for archive/unarchive |
| `packages/cli/src/server/response.ts` | Call partition, add `archivedCount` to JSON, archive/unarchive actions |
| `packages/core/src/__tests__/archive.test.ts` | New: partition tests |
| `packages/core/src/__tests__/indexer.test.ts` | Parser token tests |
| `packages/core/src/__tests__/integration/fixtures/archive/` | New: fixture files |
| `src/view/__tests__/node-actions.test.ts` | Action visibility tests |
