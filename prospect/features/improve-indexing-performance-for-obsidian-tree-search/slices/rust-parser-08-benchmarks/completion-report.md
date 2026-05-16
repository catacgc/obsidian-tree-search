## Completion Checklist

### Tasks
- [x] Task 1 — Create synthetic vault generator — PASS: `packages/parser-native/bench/generate-vault.ts` exports `generateVault(options)` with configurable params, deterministic index-based generation, frontmatter/headers/links/tags/tasks/meta-actions/nesting
- [x] Task 2 — Create MockVaultScanner — PASS: `packages/parser-native/bench/mock-scanner.ts` implements `VaultScanner` interface with `walkVault()` and `readFile()`, no filesystem I/O
- [x] Task 3 — Create counting provider wrapper — PASS: `packages/parser-native/bench/counting-provider.ts` implements `ParserProvider`, counts all method calls, has `reset()` and `getCounts()`
- [x] Task 4 — Create benchmark runner — PASS: `packages/parser-native/bench/run.ts` with WASM loading, warmup iterations, 3-iteration median for batch/index, 10-iteration for single-file, graph equivalence (order AND size), boundary crossing validation, formatted tables, asymmetry note, `process.exit(1)` on failure
- [x] Task 5 — Add `bench` scripts to package.json files — PASS: Root has `"bench": "cd packages/parser-native && bun run bench/run.ts"`, parser-native has `"bench": "bun run bench/run.ts"`
- [x] Task 6 — Verify benchmark runs and all tests pass — PASS: 252 TS tests pass, 137 Rust tests pass, benchmark completes with all assertions green

### Tests
- [x] Full suite: 252 TS passed, 137 Rust passed — PASS
- [x] Benchmark assertions: all passed (zero crossings, graph equivalence) — PASS

### Code State
- [x] No uncommitted changes to slice code — PASS (3 unrelated pre-existing changes: deleted `.claude/settings.local.json`, modified `.gitignore`, deleted `CLAUDE.md`)
- [x] No TODOs/FIXMEs introduced — PASS

### Acceptance Criteria
- [x] AC1: `packages/parser-native/bench/run.ts` exists and runnable — PASS: confirmed executable
- [x] AC2: `generate-vault.ts` produces configurable vault with representative content — PASS: 2000 files, ~20 items each
- [x] AC3: Formatted table with parse-phase and full-indexing timings at 1k and 2k — PASS: output shows table with both sizes
- [x] AC4: Workload asymmetry documented in output — PASS: NOTE block explains TS vs WASM differences
- [x] AC5: Incremental single-file reindex measured — PASS: row in timing table
- [x] AC6: CountingProviderWrapper records invocation counts — PASS: boundary crossing table printed
- [x] AC7: Zero `parseTokens` calls asserted for .md batch flow — PASS: `parseTokens calls = 0`
- [x] AC8: `packages/parser-native/package.json` has `"bench"` script — PASS
- [x] AC9: Root `package.json` has `"bench"` script — PASS
- [x] AC10: Synthetic files include frontmatter, headers, obsidian links, markdown links, HTTP URLs, inline tags, tasks, meta-actions, nested children — PASS: all present in `generate-vault.ts`
- [x] AC11: Deterministic generation — PASS: index-based, no randomness
- [x] AC12: One warmup iteration before timed runs — PASS: lines 93-94, 122-123, 158-159
- [x] AC13: Graph equivalence checks both `graph.order` AND `graph.size` — PASS: lines 200-209, output shows ✓
- [x] AC14: All existing tests pass unmodified — PASS: 252 TS + 137 Rust

## Verdict
READY FOR ARCHIVE