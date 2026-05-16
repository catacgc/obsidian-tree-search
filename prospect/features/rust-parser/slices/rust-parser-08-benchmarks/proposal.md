# Slice Proposal: rust-parser-08-benchmarks

## Problem & Outcome

**Problem:** The entire rust-parser feature exists to improve indexing performance, particularly on mobile. Slices 01-07 have delivered the Rust/WASM parser, batch API with pre-computed tokens, core integration, and plugin bundling — but there is no quantitative evidence that the implementation achieves its performance targets (3x parse-phase speedup for full vault, 2x for incremental reindex) or that the WASM boundary crossing optimization works as designed (zero per-list-item crossings during batch flow).

Crucially, the two providers perform different amounts of work at different stages: `NativeParserProvider.parseBatchChunk` pre-computes inline tokens for every list item and frontmatter parent string within a single WASM call, while `TsParserProvider.parseBatchChunk` only does frontmatter extraction + markdown scanning (inline tokens are computed later during `indexSinglePage` via the default `parseTokens` import). A raw `parseBatchChunk` timing comparison is therefore asymmetric. The full-indexing benchmark (`buildGraphFromScanner` end-to-end) is the apples-to-apples metric that captures all work for both providers.

**Outcome:** A benchmark harness that generates synthetic vaults of configurable sizes, measures both parse-phase-only and full-indexing performance for both TS and WASM parsers (with clear documentation of workload asymmetry), counts WASM boundary crossings, validates graph structural equivalence (nodes AND edges), and produces a human-readable report. This validates the feature's core promise and provides a regression detection baseline for future changes.

## Changes Introduced

1. A new `packages/parser-native/bench/` directory containing the benchmark harness.
2. A synthetic vault generator that produces markdown files of varying complexity (headers, list items with obsidian links, tags, tasks, frontmatter with parent relations, meta-actions).
3. A `MockVaultScanner` implementing `VaultScanner` for I/O-free benchmarking.
4. A `CountingProviderWrapper` that delegates to an inner provider while tracking method invocation counts.
5. A benchmark runner script that:
   - Generates synthetic vaults (1k and 2k notes)
   - Runs one warmup iteration (discarded) before timed measurements
   - Measures parse-phase-only time (`parseBatchChunk`) for both parsers, with a note documenting workload asymmetry
   - Measures full-indexing time (`buildGraphFromScanner` with each provider) — the primary apples-to-apples comparison
   - Validates graph equivalence using both node count (`graph.order`) and edge count (`graph.size`)
   - Counts WASM boundary crossings during a full WASM batch run (asserting zero per-list-item crossings for .md files)
   - Measures incremental single-file reindex parse-phase time for both parsers
   - Outputs results to stdout in a formatted table
6. `bench` scripts in both `packages/parser-native/package.json` and root `package.json`.

## Scope

### In-scope
- Synthetic vault generator (parameterized: file count, items per file, link density, frontmatter complexity)
- Parse-phase-only benchmarks (`parseBatchChunk` timing) with documented asymmetry
- Full-indexing benchmarks (`buildGraphFromScanner` end-to-end timing) — primary metric
- Incremental single-file reindex benchmark (`parseVaultFile` timing)
- WASM boundary crossing counter (wrapping provider to count calls)
- Graph structural equivalence assertion (node count AND edge count)
- Warmup iteration before all timed runs
- Formatted console output with timing comparisons and speedup ratios

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
2. A synthetic vault generator at `packages/parser-native/bench/generate-vault.ts` produces a `Record<string, string>` (path → content) with configurable count (default 2000), ~20 items/file, and representative content (obsidian links, markdown links, HTTP URLs, inline tags, tasks, meta-actions, frontmatter with tags/aliases/parent links, nested children, multiple headers).
3. Running the benchmark produces a formatted table on stdout showing: TS time, WASM time, speedup ratio — for both parse-phase-only (batch) and full indexing (apples-to-apples) at 1k and 2k vault sizes.
4. The benchmark output includes a note documenting the workload asymmetry: WASM parse-phase includes inline token pre-computation for every list item (~20x more work per file) while TS parse-phase does not; full indexing is the true equivalent-work comparison.
5. The benchmark measures incremental single-file reindex (`parseVaultFile`) for both parsers and reports the speedup.
6. A `CountingProviderWrapper` records the number of WASM boundary crossings (`parseBatchChunk`, `parseTokens`, `parseVaultFile` call counts) during a full 2k-note batch-indexed run, and reports them.
7. The benchmark asserts that for a 2k-note vault processed through the batch path (no canvas files), zero individual `parseTokens` calls are made for .md files (all tokens come from `precomputedTokens`).
8. A `"bench"` script in `packages/parser-native/package.json` runs the benchmark.
9. A `"bench"` script in the root `package.json` runs the benchmark (delegating to parser-native).
10. The synthetic vault generator produces files with: frontmatter (tags, aliases, parent links with `[[...]]`), headers (2-3 per file), obsidian `[[link]]` and `[[Page#Header|Alias]]`, markdown `[text](url)`, HTTP URLs, inline `#tag`, tasks (`- [ ]` and `- [x]`), meta-actions (`(meta-action-name::N)(meta-action-url::U)`), and nested children (2-3 levels deep).
11. Generation is deterministic — calling `generateVault` twice with identical parameters produces identical output.
12. One warmup iteration (discarded) runs before timed iterations to account for JIT compilation and WASM module warm-up.
13. Full-indexing graph equivalence check compares both `graph.order` (node count) AND `graph.size` (edge count) between TS and WASM provider results.
14. All existing tests (252 TS + 137 Rust) continue to pass unmodified.
