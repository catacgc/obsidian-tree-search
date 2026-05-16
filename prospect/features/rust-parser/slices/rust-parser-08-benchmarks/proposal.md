# Slice Proposal: rust-parser-08-benchmarks

## Problem & Outcome

**Problem:** The entire rust-parser feature exists to improve indexing performance, particularly on mobile. Slices 01-07 have delivered the Rust/WASM parser, batch API with pre-computed tokens, core integration, and plugin bundling — but there is no quantitative evidence that the implementation achieves its performance targets (3x parse-phase speedup for full vault, 2x for incremental reindex) or that the WASM boundary crossing optimization works as designed (zero per-list-item crossings during batch flow).

**Outcome:** A benchmark harness that generates synthetic vaults of configurable sizes, measures parse-phase-only and full-indexing performance for both TS and WASM parsers, counts WASM boundary crossings, and produces a human-readable report. This validates the feature's core promise and provides a regression detection baseline for future changes.

## Changes Introduced

1. A new `packages/parser-native/bench/` directory containing the benchmark harness.
2. A synthetic vault generator that produces markdown files of varying complexity (headers, list items with obsidian links, tags, tasks, frontmatter with parent relations, meta-actions).
3. A benchmark runner script that:
   - Generates synthetic vaults (1k and 2k notes)
   - Measures parse-phase-only time for TS parser (`TsParserProvider.parseBatchChunk`)
   - Measures parse-phase-only time for WASM parser (`NativeParserProvider.parseBatchChunk`)
   - Measures full-indexing time (`buildGraphFromScanner` with each provider)
   - Counts WASM boundary crossings during a full WASM batch run (asserting zero per-list-item crossings for .md files)
   - Measures incremental single-file reindex parse-phase time for both parsers
   - Outputs results to stdout in a formatted table
4. A `bench` script in `packages/parser-native/package.json`.
5. A root-level `bench` script in the top-level `package.json`.

## Scope

### In-scope
- Synthetic vault generator (parameterized: file count, items per file, link density, frontmatter complexity)
- Parse-phase-only benchmarks (parseBatchChunk / parseVaultFile timing)
- Full-indexing benchmarks (buildGraphFromScanner end-to-end timing)
- Incremental single-file reindex benchmark (reindexFileInGraph timing)
- WASM boundary crossing counter (wrapping provider to count calls)
- Formatted console output with timing comparisons and speedup ratios
- Assertion that batch flow makes zero individual parseTokens WASM calls for .md files

### Non-goals (explicitly excluded)
- Browser-based benchmarks or Obsidian mobile benchmarks (those require manual testing)
- CI integration of benchmarks (that's slice 09)
- Persisted benchmark history or regression detection automation
- Benchmarking the esbuild bundle step or WASM load time
- Profiling or flame graph generation
- Optimization work based on benchmark results

## Feature Mapping

- **Source feature:** `rust-parser`
- **Slice item:** `rust-parser-08-benchmarks`

## Acceptance Criteria

1. A script at `packages/parser-native/bench/run.ts` exists and is executable via `bun run packages/parser-native/bench/run.ts`.
2. A synthetic vault generator at `packages/parser-native/bench/generate-vault.ts` produces a directory structure of `.md` files with configurable count (default 2000), items per file (~20), and link/tag density.
3. Running the benchmark produces a formatted table on stdout showing: TS parse time, WASM parse time, speedup ratio — for both batch parse-phase and full indexing at 1k and 2k vault sizes.
4. The benchmark measures incremental single-file reindex (parse phase only) for both parsers and reports the speedup.
5. A counting wrapper records the number of WASM boundary crossings (calls to `parseBatchChunk`, `parseTokens`, `parseVaultFile`) during a full 2k-note batch-indexed run, and the output includes these counts.
6. The benchmark asserts that for a 2k-note vault processed through the batch path, zero individual `parseTokens` calls are made for .md files (all tokens come from `precomputedTokens`).
7. A `"bench"` script in `packages/parser-native/package.json` runs the benchmark.
8. A `"bench"` script in the root `package.json` runs the benchmark (delegating to parser-native).
9. The synthetic vault generator produces files with: frontmatter (tags, aliases, parent links), headers (2-3 per file), list items with obsidian links, markdown links, HTTP URLs, inline tags, tasks (completed and incomplete), meta-actions, and nested children.
10. All existing tests (252 TS + 137 Rust) continue to pass unmodified.
