### Critical (must fix before archiving)
(none)

### Warnings (should address or explicitly defer)
- [ ] **`bench/` directory excluded from all tsconfig.json type-checking** — The `packages/parser-native/tsconfig.json:16` includes only `"ts/**/*.ts"`, meaning `bench/*.ts` files are never type-checked by `tsc`. Type errors in the benchmark (e.g., wrong argument types, missing properties) would only surface at runtime. This could hide breaking changes in future refactors. — `packages/parser-native/tsconfig.json:16`
- [ ] **Generated vault includes `"archive"` tag in some files' frontmatter, creating inconsistent indexing across providers** — `generate-vault.ts:18` includes `"archive"` in the `TAGS` array. Files with `fileIndex % 10 === 9` or `(fileIndex + 3) % 10 === 9` get `"archive"` as a frontmatter tag. This means ~10% of pages are treated as archived by `indexSinglePage` (early return at `indexer.ts:249`), which reduces the graph output and exercises a partial path. While not incorrect, it means the graph equivalence check validates an asymmetric workload where some files contribute no nodes/edges. More importantly, if the TS and WASM frontmatter parsers handle YAML arrays slightly differently (e.g., the "archive" value ending up differently typed), this could mask or expose graph divergence unrelated to the main parsing path. — `packages/parser-native/bench/generate-vault.ts:18,28-29`

### Suggestions (consider before or after archiving)
- [ ] **Parse-phase timing passes ALL files in one call instead of chunked** — In `run.ts:93-94,102`, the parse-phase benchmark calls `parseBatchChunk(files)` with all 1000/2000 files in a single call. The WASM side serializes this as one massive JSON string (potentially 5-10 MB). In production, files are processed in chunks of 50 (per `builder.ts:89-96`). Consider also measuring chunked parse timing for a more realistic comparison, or at least noting this discrepancy. — `packages/parser-native/bench/run.ts:93-94,102`
- [ ] **Consider adding a check that the benchmark actually produced meaningful output** — The benchmark could succeed with both parsers producing 0 nodes/0 edges (e.g., if all files fail to parse). A sanity assertion that `graph.order > 0` and/or that it's a meaningful fraction of the 2000 files would catch silently broken parsers. — `packages/parser-native/bench/run.ts:134-139`

### Verified
- [x] AC1: `packages/parser-native/bench/run.ts` exists — confirmed at expected path
- [x] AC2: `generate-vault.ts` exports `generateVault(options)` with configurable count, ~20 items/file, representative content — confirmed at `generate-vault.ts:191`
- [x] AC3: Formatted table with parse-phase and full-indexing timings at 1k and 2k — confirmed at `run.ts:223-241`
- [x] AC4: Asymmetry documentation — confirmed at `run.ts:216-219,242`
- [x] AC5: Incremental single-file reindex measured — confirmed at `run.ts:152-174`
- [x] AC6: CountingProviderWrapper records call counts — confirmed at `counting-provider.ts:8-47`
- [x] AC7: Zero parseTokens assertion for .md batch flow — confirmed at `run.ts:187-189`
- [x] AC8: `packages/parser-native/package.json` has `"bench"` script — confirmed at line 11
- [x] AC9: Root `package.json` has `"bench"` script — confirmed at line 12
- [x] AC10: Synthetic files include required content varieties (frontmatter, headers, obsidian links, markdown links, HTTP URLs, inline tags, tasks, meta-actions, nested children) — confirmed in `generate-vault.ts:22-168`
- [x] AC11: Deterministic generation (no randomness) — confirmed, no `Math.random` or similar; all index-based
- [x] AC12: Warmup iteration before timed runs — confirmed at `run.ts:93-94,122-123,158-159`
- [x] AC13: Graph equivalence checks both `graph.order` AND `graph.size` — confirmed at `run.ts:200-209`
- [x] AC14: All existing tests pass unmodified — confirmed from prior output (252 TS + 137 Rust)
- [x] `VaultScanner` interface correctly implemented by `MockVaultScanner` — confirmed types match `scanner.ts:17-19`
- [x] `ParserProvider` interface correctly implemented by `CountingProviderWrapper` — confirmed matches `parser-provider.ts:12-21`
- [x] All imports resolve to valid exports from `@mdtree/core` and `../ts/index.ts` — verified `FileInput`, `TsParserProvider`, `buildGraphFromScanner`, `ParserProvider`, `DvPage`, `ParsedTextToken`, `VaultScanner`, `VaultFile`, `VaultFolder`, `WalkResult`
- [x] WASM path resolution correct (`../pkg/parser_native_bg.wasm` relative to `bench/`) — confirmed file exists
- [x] No TODOs/FIXMEs introduced — confirmed via grep
- [x] `settings` object matches `IndexSettings` type — confirmed `{ parentRelation, archiveTag, searchSeparator }`
- [x] Boundary crossing count logic correct — batch path calls `parseBatchChunk` not `parseTokens`; `precomputedTokens` prevents fallback in `indexSinglePage`; no canvas files in synthetic vault