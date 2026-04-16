# Plugin → @mdtree/core Migration Design

**Date:** 2026-04-16  
**Status:** Approved

## Goal

Replace the Obsidian plugin's duplicated graph, search, indexing, and Raycast code with direct use of `@mdtree/core` and `@mdtree/cli`. The plugin becomes a thin Obsidian shell: vault path, file-change events, UI, and settings — nothing else.

---

## Architecture After Migration

```
@mdtree/core
  NotesGraph, all node/edge types
  indexSinglePage, parseCanvasData
  searchIndex, advancedSearch, searchParents, flattenTasks
  parseQuery, matchQuery, QueryExpr, ...

@mdtree/cli  (new ./vault export)
  buildGraph(vaultRoot, settings) → NotesGraph
  reindexFile(absPath, vaultRoot, graph, settings)

src/ (plugin — Obsidian shell only)
  IndexedTree   → calls buildGraph / reindexFile, holds state in Jotai
  Views / UI    → queries NotesGraph via core search functions
  Settings      → parentRelation, archiveTag, searchSeparator
```

Dataview and Raycast integrations are **removed entirely**. The plugin reads the vault directly from the filesystem, exactly as `mdtree index --vault <path>` does.

---

## What Gets Deleted

| File/directory | Reason |
|---|---|
| `src/graph.ts` | Types + graphology-backed `NotesGraph` — all from `@mdtree/core` |
| `src/search/search.ts` | Duplicates `@mdtree/core` search functions |
| `src/search/query.ts` | Duplicates `@mdtree/core` query parser |
| `src/indexing/parser.ts` | Duplicates `parseTokens` from `@mdtree/core` |
| `src/indexing/text-parser.ts` | Duplicates `buildNodesFromTextLines` from `@mdtree/core` |
| `src/indexing/markdown.ts` | MarkdownIndexer replaced by `buildGraph` / `reindexFile` |
| `src/indexing/canvas.ts` | CanvasIndexer replaced by `buildGraph` / `reindexFile` |
| `src/indexing/indexed-tree.ts` | Rewritten (see below) |
| `src/view/raycast/` | Replaced by `mdtree serve` CLI command |

---

## What Gets Rewritten

### `@mdtree/cli/package.json` — add vault export

```json
"exports": {
  ".": "./src/main.ts",
  "./vault": "./src/vault/indexer.ts"
}
```

This exposes `buildGraph` and `reindexFile` as a library entry point without pulling in `chokidar`, `commander`, or `ignore`.

### `src/indexing/indexed-tree.ts` — stripped to ~40 lines

Responsibilities:
- Hold a `NotesGraph` instance in Jotai state
- `refresh()` → derive vault path from `app.vault.adapter.basePath`, call `buildGraph(vaultPath, settings)`, update store
- File-change handler → derive absolute path, call `reindexFile(absPath, vaultPath, graph, settings)`, update store
- No batching, no Indexer interface, no Dataview, no folder walking

### `src/main.ts`

- Remove `waitForDataview` / Dataview gate
- Remove `RaycastServer` import and `server.start()` / `server.stop()`
- Call `this.index.refresh()` directly on `onload`

### `src/view/react-context/global.tsx`

- Import `NotesGraph` from `@mdtree/core` instead of `../../graph`

### `src/view/react-context/state.tsx`

- Import all search functions and types from `@mdtree/core`
- `graph.graph` → `graph` everywhere
- `graph.graph.nodes().length` → `graph.order`
- `graph.graph.edges().length` → `graph.size`
- `flattenTasks(results).nodes` → `flattenTasks(results)` (core returns `ResultNode[]` directly)
- `searchParents(graph.graph, file: TFile)` → `searchParents(graph, file.basename)`

### All other `src/view/**` and `src/obsidian-utils.ts`

- Replace `from '../../graph'` / `from 'src/graph'` with `from '@mdtree/core'`
- Replace `from '../../search/search'` with `from '@mdtree/core'`
- Replace `from '../../search/query'` with `from '@mdtree/core'`
- `graph.graph` → `graph` in `raycast-server.ts`, `InlineMarkdownResults.tsx`

---

## Dependency Changes

**`package.json` (root / plugin)**

- Remove: `graphology`, `obsidian-dataview`
- Add: `@mdtree/core: workspace:*`, `@mdtree/cli: workspace:*`

---

## Migration Layers (execution order)

### Layer 1 — Core types and search

Add `@mdtree/core` dep. Delete `src/graph.ts`, `src/search/search.ts`, `src/search/query.ts`, `src/indexing/parser.ts`. Fix all import paths in view files to point at `@mdtree/core`. Plugin must typecheck after this layer.

### Layer 2 — Vault indexer

Add `@mdtree/cli` dep + vault export. Delete `src/indexing/markdown.ts`, `src/indexing/canvas.ts`, `src/indexing/text-parser.ts`. Rewrite `src/indexing/indexed-tree.ts`. Update `src/main.ts` (remove Dataview gate). Plugin must typecheck after this layer.

### Layer 3 — Raycast removal + call-site cleanup

Delete `src/view/raycast/`. Fix remaining `graph.graph` usages in `state.tsx`, `InlineMarkdownResults.tsx`. Fix `flattenTasks` and `searchParents` call signatures. Remove `graphology` and `obsidian-dataview` from `package.json`. Plugin must typecheck and build after this layer.

---

## Compatibility Notes

- **`DvList.rawText`**: core's `indexSinglePage` uses `rawText`; the CLI's `parseVaultFile` populates it from the raw markdown. Since we now use `buildGraph` which calls `parseVaultFile` internally, this is handled automatically — no adapter needed.
- **`flattenTasks` return type**: core returns `ResultNode[]`; callers that access `.nodes` must be updated.
- **`searchParents` signature**: takes `basename: string`, not `TFile` — pass `file.basename`.
- **Vault path**: `(app.vault.adapter as any).basePath` gives the absolute root path on desktop.
- **Node count display**: `graph.order` (nodes) and `graph.size` (edges) replace graphology equivalents.
