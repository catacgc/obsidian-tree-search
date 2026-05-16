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
  - Some items having markdown links `[text](http://example.com/path)`
  - Some items with bare HTTP URLs `http://example.com/resource`
  - Some items with inline tags `#tag-name`
  - Some items as tasks `- [ ] task` or `- [x] completed`
  - Some items with meta-actions `(meta-action-name::Name)(meta-action-url::https://url.com)`
  - Some items with nested children (indent level 2-3 deep)

Use deterministic index-based generation (no randomness — use `i % N` patterns for variation). Return the map directly (no filesystem writes). Verify that calling `generateVault` twice with identical parameters produces identical output.

## Task 2 — Create MockVaultScanner for benchmark use

**File:** `packages/parser-native/bench/mock-scanner.ts`

Create a `MockVaultScanner` implementing `VaultScanner` from `@mdtree/core` that wraps the in-memory vault map from Task 1:

- `walkVault()` returns:
  - `files`: all entries as `VaultFile[]` with `type: "markdown"`, `mtime: 1700000000000`
  - `folders`: deduplicated from path prefixes (e.g., `"projects/sub/note.md"` → folders `"projects"` and `"projects/sub"`)
- `readFile(relPath)` returns `{ content, mtime: 1700000000000 }` from the map

This avoids any filesystem I/O during benchmarking, isolating parse/index time only. The scanner implementation must match the `VaultScanner` interface at `packages/core/src/graph/scanner.ts` exactly: `walkVault() → Promise<WalkResult>` and `readFile(relPath) → Promise<{content: string; mtime: number}>`.

## Task 3 — Create counting provider wrapper

**File:** `packages/parser-native/bench/counting-provider.ts`

Create a `CountingProviderWrapper` class that implements `ParserProvider` by delegating to an inner provider while counting method invocations:

```typescript
export class CountingProviderWrapper implements ParserProvider {
  batchChunkCalls = 0
  parseTokensCalls = 0
  parseVaultFileCalls = 0
  totalFilesInBatches = 0

  constructor(private inner: ParserProvider) {}

  parseBatchChunk(files: FileInput[]): DvPage[] {
    this.batchChunkCalls++
    this.totalFilesInBatches += files.length
    return this.inner.parseBatchChunk(files)
  }

  parseTokens(text: string): ParsedTextToken[] {
    this.parseTokensCalls++
    return this.inner.parseTokens(text)
  }

  parseVaultFile(content: string, filePath: string, mtime: number, archiveTag: string): DvPage {
    this.parseVaultFileCalls++
    return this.inner.parseVaultFile(content, filePath, mtime, archiveTag)
  }

  reset(): void {
    this.batchChunkCalls = 0
    this.parseTokensCalls = 0
    this.parseVaultFileCalls = 0
    this.totalFilesInBatches = 0
  }

  getCounts() {
    return {
      batchChunkCalls: this.batchChunkCalls,
      parseTokensCalls: this.parseTokensCalls,
      parseVaultFileCalls: this.parseVaultFileCalls,
      totalFilesInBatches: this.totalFilesInBatches,
    }
  }
}
```

## Task 4 — Create benchmark runner

**File:** `packages/parser-native/bench/run.ts`

Create the main benchmark script that:

1. **Load WASM:** Read bytes from `packages/parser-native/pkg/parser_native_bg.wasm` (relative path resolved from `import.meta.dir`), call `loadNativeParser(wasmBytes)`, create `NativeParserProvider`.
2. **Create TS provider:** `new TsParserProvider()` from `@mdtree/core`.
3. **For each vault size** (1000, 2000):
   a. Generate synthetic vault via `generateVault({ fileCount: N })`
   b. Create `MockVaultScanner` from the vault map
   c. Prepare `FileInput[]` array from the vault map (all files with archiveTag "archive")
   d. **Parse-phase benchmark (batch):**
      - 1 warmup iteration for each provider (discarded)
      - Time `provider.parseBatchChunk(allFiles)` for both TS and WASM (3 iterations, take median)
   e. **Full-indexing benchmark:**
      - 1 warmup iteration for each provider (discarded)
      - Time `buildGraphFromScanner(scanner, settings, provider)` for both TS and WASM (3 iterations, take median)
      - After first timed iteration, compare `graph.order` AND `graph.size` between TS and WASM results to assert structural equivalence
4. **Incremental reindex:**
   a. Pick the first file from the 2k vault
   b. 1 warmup iteration (discarded)
   c. Time `provider.parseVaultFile(content, path, mtime, archiveTag)` for both parsers (10 iterations, median)
5. **WASM boundary crossing validation:**
   a. Wrap `NativeParserProvider` in `CountingProviderWrapper`
   b. Run `buildGraphFromScanner(scanner, settings, countingProvider)` on 2k vault
   c. Assert `countingProvider.parseTokensCalls === 0` (synthetic vault has no canvas files)
   d. Assert `countingProvider.batchChunkCalls === Math.ceil(2000 / 50)` (default chunkSize)
   e. Assert `countingProvider.parseVaultFileCalls === 0`
   f. Report the counts
6. **Format and print results** using `console.log`:

```
=== WASM Parser Benchmark Results ===

NOTE: Parse-phase (batch) comparison is ASYMMETRIC:
  - WASM parseBatchChunk: frontmatter + scan + inline tokens for EVERY list item (full parse)
  - TS parseBatchChunk: frontmatter + scan only (inline tokens computed later in indexSinglePage)
  Full indexing is the apples-to-apples comparison (same total work, same graph output).

| Benchmark                      | TS (ms)  | WASM (ms) | Speedup |
|--------------------------------|----------|-----------|---------|
| Parse-phase 1k notes (batch)*  | ...      | ...       | ...x    |
| Parse-phase 2k notes (batch)*  | ...      | ...       | ...x    |
| Full index 1k notes            | ...      | ...       | ...x    |
| Full index 2k notes            | ...      | ...       | ...x    |
| Incremental single file        | ...      | ...       | ...x    |

* Parse-phase rows show asymmetric workloads (see note above)

=== Graph Equivalence ===
| Vault Size | TS nodes | WASM nodes | TS edges | WASM edges | Match |
|------------|----------|------------|----------|------------|-------|
| 1k         | ...      | ...        | ...      | ...        | ✓/✗   |
| 2k         | ...      | ...        | ...      | ...        | ✓/✗   |

=== WASM Boundary Crossings (2k vault, batch flow) ===
| Metric                  | Count |
|-------------------------|-------|
| parseBatchChunk calls   | 40    |
| parseTokens calls       | 0     |
| parseVaultFile calls    | 0     |
| Total files in batches  | 2000  |
```

Use `performance.now()` for all timings. Compute median from sorted array. Script should `process.exit(1)` if any assertion fails (zero crossings, graph equivalence).

## Task 5 — Add `bench` scripts to package.json files

**Files to modify:**
- `packages/parser-native/package.json` — add to `"scripts"`: `"bench": "bun run bench/run.ts"`
- Root `package.json` — add to `"scripts"`: `"bench": "cd packages/parser-native && bun run bench/run.ts"`

## Task 6 — Verify benchmark runs and all existing tests pass

Run:
- `bun test` from project root (all 252 TS tests pass)
- `cd packages/parser-native && cargo test` (all 137 Rust tests pass)
- `bun run bench` from root (benchmark produces output without errors, all assertions pass)

Verify:
- The benchmark completes and prints the results table
- The zero-crossings assertion passes (no `parseTokens` calls for .md batch flow)
- Graph equivalence passes (same `order` AND `size` for both providers)
- No existing test files are modified
