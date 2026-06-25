# Remove WASM Parser, Unify Code Paths, Persistent mtime Cache

**Date:** 2026-06-25
**Status:** Approved

## Background

The project ships a Rust/WASM parser (`packages/parser-native/`) as an optional fast path in `buildGraphFromScanner`. Benchmarks show the WASM path is **slower** than the TypeScript fallback in all scenarios (full index 1k notes: TS 183ms vs WASM 245ms; full index 2k notes: TS 477ms vs WASM 614ms). The JSON serialization overhead at the WASM boundary dominates any CPU savings from Rust. The WASM path adds a Rust build pipeline, a bundled binary asset, a try/catch loader, and a two-branch function body — all complexity with no performance benefit.

Separately, the Obsidian plugin's mtime-based parse cache lives only in memory and is discarded on every plugin restart, forcing a full re-parse of all vault files each time. The CLI has no cache at all.

This spec covers three coordinated changes:

1. Delete the WASM/Rust parser and simplify to a single TypeScript code path.
2. Ensure both the Obsidian plugin and the CLI use identical `buildGraphFromScanner` logic.
3. Persist the mtime parse cache to disk so restarts only re-parse changed files.

## Deletions

### Entire package removed
- `packages/parser-native/` — Rust source, WASM binary (`pkg/`), TypeScript glue (`ts/`), bench runner (`bench/`)

### Plugin files removed
- `src/wasm/parser-native-wasm.ts` — bundled WASM bytes
- `src/indexing/load-native-parser.ts` — dynamic loader with try/catch fallback

### Simplified / cleaned up
- `packages/core/src/parser/parser-provider.ts` — delete entirely (`ParserProvider` interface, `TsParserProvider` class)
- `packages/core/src/index.ts` — remove all provider-related exports (`ParserProvider`, `TsParserProvider`, `FileInput`)
- `src/main.ts` — remove `loadNativeParserProvider()` call and `parserTypeAtom` assignment
- `src/indexing/indexed-tree.ts` — remove `setParserProvider()` method and `provider` field
- `src/view/react-context/global.tsx` — remove `parserTypeAtom` if only used to track WASM vs TS

## Core Simplification — `buildGraphFromScanner`

### New signature

```typescript
export async function buildGraphFromScanner(
  scanner: VaultScanner,
  settings: IndexSettings = DEFAULT_SETTINGS,
  parseCache?: Map<string, ParseCacheEntry>,
): Promise<NotesGraph>
```

The `provider` and `chunkSize` parameters are removed. The function body collapses from ~300 lines (two branches) to ~120 lines (current fallback path, unchanged in logic).

### Single code path

1. `scanner.walkVault()` → `{ files, folders }`
2. Create folder nodes in the graph
3. Partition files by type: `.md`, `.canvas`, attachments
4. For each `.md` file: if `parseCache` has a matching `mtime` → use the cached `DvPage` (skip read + parse)
5. Cache-miss `.md` files: read in parallel batches of 64, parse with `parseVaultFile`, store result in `parseCache`
6. `.canvas` files: read in parallel batches, process with `parseCanvasData`
7. Attachments: `graph.addAttachmentNode()` (no I/O)
8. Prune stale `parseCache` entries for paths no longer in the vault

### `reindexFileInGraph`

```typescript
export async function reindexFileInGraph(
  relPath: string,
  graph: NotesGraph,
  scanner: VaultScanner,
  settings: IndexSettings,
  parseCache?: Map<string, ParseCacheEntry>,
): Promise<void>
```

The `provider` param is removed. The function always calls `parseVaultFile` directly.

## Cache Serialization — `packages/core/src/graph/cache.ts`

A new file exporting two pure functions (no I/O):

```typescript
export type SerializedCache = {
  version: 1
  entries: Record<string, ParseCacheEntry>  // vault-relative path → { page, mtime }
}

export function serializeCache(cache: Map<string, ParseCacheEntry>): string
export function deserializeCache(json: string): Map<string, ParseCacheEntry>
```

`deserializeCache` returns an empty `Map` on any failure (missing file, corrupted JSON, unknown version). The worst outcome is a full re-parse on the next startup — no crash, no data loss.

**Version bumping:** if `DvPage` schema changes in a future release, bump the `version` field. An unknown version → empty Map → transparent full rebuild.

**Size expectations:** a typical note's `DvPage` serializes to ~2–5 KB. A 1k-file vault produces a ~2–5 MB cache file; a 5k-file vault ~10–25 MB. Acceptable as a dotfile.

Both functions are exported from `@mdtree/core` so the plugin and CLI share identical serialization logic.

## Plugin Cache Persistence — `IndexedTree`

### Constructor change

```typescript
constructor(private store: GlobalStore, private cachePath: string)
```

The cache file path is `.obsidian/plugins/tree-search/parse-cache.json` — the plugin's own directory, no new directories needed. In `main.ts`:

```typescript
this.index = new IndexedTree(this.globalStore, this.manifest.dir)
```

### New private methods

```typescript
private async loadCache(): Promise<void>  // deserializeCache → populate this.parseCache
private async saveCache(): Promise<void>  // serializeCache → write file
```

I/O uses `app.vault.adapter.read()` / `app.vault.adapter.write()`.

### Updated `refresh()` flow

1. `loadCache()` — populate `this.parseCache` from disk (no-op if file missing)
2. `buildGraphFromScanner(scanner, settings, this.parseCache)` — only re-parses changed files
3. `saveCache()` — persist updated cache to disk
4. `setState(graph)`

`refreshPage()` is unchanged — it continues updating `this.parseCache` in-memory on each file save event. The persisted cache written by the next `refresh()` will include those incremental updates.

## CLI Cache Persistence — `packages/cli/src/vault/indexer.ts`

### `buildGraph` return type change

```typescript
export async function buildGraph(
  vaultRoot: string,
  settings: IndexSettings = DEFAULT_SETTINGS,
): Promise<{ graph: NotesGraph; cache: Map<string, ParseCacheEntry> }>
```

The cache is returned so `serve` and `watch` commands can pass it to subsequent `reindexFile` calls.

### `buildGraph` flow

1. Load cache from `<vaultRoot>/.mdtree/cache.json` via Node `fs/promises` + `deserializeCache` (empty Map if missing)
2. `buildGraphFromScanner(new NodeVaultScanner(vaultRoot), settings, cache)`
3. Save updated cache to `.mdtree/cache.json` via `serializeCache`
4. Return `{ graph, cache }`

### `reindexFile` signature change

```typescript
export async function reindexFile(
  absPath: string,
  vaultRoot: string,
  graph: NotesGraph,
  settings: IndexSettings,
  parseCache?: Map<string, ParseCacheEntry>,
  store?: VaultStore,
  vault?: string,
): Promise<void>
```

The `serve` and `watch` commands hold the `cache` reference from `buildGraph` and pass it to each `reindexFile` call. After each reindex, the cache is saved to disk so it stays consistent across process restarts.

### Cache file location

`<vaultRoot>/.mdtree/cache.json`

`.mdtree/` is added to `.gitignore` (local build artifact).

## What Does Not Change

- `VaultScanner` interface — unchanged
- `ObsidianVaultScanner` — unchanged
- `NodeVaultScanner` / `walker.ts` — unchanged
- `NotesGraph`, `indexSinglePage`, `searchIndex`, all graph query logic — unchanged
- `RaycastServer` — unchanged (reads live graph from Jotai store)
- Mobile plugin behaviour — unchanged (already ran the fallback path; now it just runs the only path)
