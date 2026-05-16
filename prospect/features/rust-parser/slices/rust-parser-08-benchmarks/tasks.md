# Implementation Tasks: rust-parser-08-benchmarks

## Task 1 — Create synthetic vault generator

**File:** `packages/parser-native/bench/generate-vault.ts`

Create a module that exports a `generateVault(options)` function producing an in-memory map of `Record<string, string>` (path → content) representing a synthetic vault. Options:

- `fileCount: number` (default 2000)
- `itemsPerFile: number` (default 20)
- `headersPerFile: number` (default 3)
- `linkDensity: number` (0-1, fraction of items containing obsidian links, default 0.7)
- `tagDensity: number` (0-1, fraction of items containing inline tags, default 0.3)
- `taskDensity: number` (0-1, fraction of items that are tasks, default 0.2)
- `metaActionDensity: number` (0-1, fraction of items with meta-actions, default 0.1)
- `parentRelationDensity: number` (0-1, fraction of files with frontmatter parent links, default 0.4)

Each generated file must include:
- Frontmatter with `tags` (array), `aliases` (array), and optionally `parent: "[[SomePage]]"`
- 2-3 headers (level 1-3)
- ~20 list items distributed under headers, with:
  - Some items having obsidian links `[[PageName]]` or `[[Page#Header|Alias]]`
  - Some items having markdown links `[text](http://example.com)`
  - Some items with inline tags `#tag`
  - Some items as tasks `- [ ] task` or `- [x] completed`
  - Some items with meta-actions `(meta-action-name::Name)(meta-action-url::URL)`
  - Some items with nested children (indent level 2-3)

Return the map directly (no filesystem writes). The generator uses deterministic seeding (simple LCG or index-based) so results are reproducible.

## Task 2 — Create VaultScanner mock for benchmark use

**File:** `packages/parser-native/bench/mock-scanner.ts`

Create a `MockVaultScanner` implementing `VaultScanner` from `@mdtree/core` that wraps the in-memory vault map from Task 1:

- `walkVault()` returns `files` (all `.md` entries with mtime=1700000000000) and `folders` (derived from path prefixes)
- `readFile(relPath)` returns `{ content, mtime: 1700000000000 }` from the map

This avoids any filesystem I/O during benchmarking, isolating parse/index time.

## Task 3 — Create counting provider wrapper

**File:** `packages/parser-native/bench/counting-provider.ts`

Create a `CountingProviderWrapper` class that implements `ParserProvider` by delegating to an inner provider while counting method invocations:

```
class CountingProviderWrapper implements ParserProvider {
  batchChunkCalls = 0
  parseTokensCalls = 0
  parseVaultFileCalls = 0
  totalFilesInBatches = 0
  
  // delegates to inner, increments counters
}
```

Also export a `resetCounts()` method and a `getCounts()` method for reporting.

## Task 4 — Create benchmark runner

**File:** `packages/parser-native/bench/run.ts`

Create the main benchmark script that:

1. Loads the WASM module from `packages/parser-native/pkg/parser_native_bg.wasm`
2. Creates `NativeParserProvider` and `TsParserProvider` instances
3. For each vault size (1000, 2000):
   a. Generate synthetic vault via `generateVault({ fileCount: N })`
   b. Create `MockVaultScanner` from the vault map
   c. **Parse-phase benchmark (batch):** Time `provider.parseBatchChunk(allFiles)` for both TS and WASM (run 3 iterations, take median)
   d. **Full-indexing benchmark:** Time `buildGraphFromScanner(scanner, settings, provider)` for both TS and WASM (3 iterations, median)
4. For incremental reindex:
   a. Pick a single file from the 2k vault
   b. Time `provider.parseVaultFile(content, path, mtime, archiveTag)` for both parsers (10 iterations, median)
5. For WASM boundary crossing validation:
   a. Wrap the NativeParserProvider in `CountingProviderWrapper`
   b. Run `buildGraphFromScanner(scanner, settings, countingProvider)` on 2k vault
   c. Assert `parseTokensCalls === 0` for the .md file batch flow (only canvas calls are allowed)
   d. Report the counts: total batchChunkCalls, parseTokensCalls, parseVaultFileCalls
6. Format and print results table

Use `performance.now()` for timing (available in Bun). Print a markdown-style table:

```
| Benchmark                    | TS (ms)  | WASM (ms) | Speedup |
|------------------------------|----------|-----------|---------|
| Parse-phase 1k notes (batch) | ...      | ...       | ...x    |
| Parse-phase 2k notes (batch) | ...      | ...       | ...x    |
| Full index 1k notes          | ...      | ...       | ...x    |
| Full index 2k notes          | ...      | ...       | ...x    |
| Incremental single file      | ...      | ...       | ...x    |
```

And a boundary crossing report:

```
| Metric                  | Count |
|-------------------------|-------|
| parseBatchChunk calls   | N     |
| parseTokens calls (md)  | 0     |
| parseVaultFile calls    | 0     |
| Total files in batches  | 2000  |
```

## Task 5 — Add `bench` scripts to package.json files

**Files:**
- `packages/parser-native/package.json` — add `"bench": "bun run bench/run.ts"`
- Root `package.json` — add `"bench": "cd packages/parser-native && bun run bench/run.ts"`

## Task 6 — Verify benchmark runs and all existing tests pass

Run:
- `bun test` (all 252 TS tests pass)
- `cd packages/parser-native && cargo test` (all 137 Rust tests pass)
- `bun run bench` from root (benchmark produces output without errors)

Verify the benchmark completes and prints the results table. The assertion about zero `parseTokens` WASM calls for .md files must pass (this validates the pre-computed tokens design).
