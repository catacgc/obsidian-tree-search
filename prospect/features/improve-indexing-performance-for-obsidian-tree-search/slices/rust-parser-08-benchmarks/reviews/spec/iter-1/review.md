### Critical (must fix before implementation)
(none)

### Warnings (should address, discuss if not)
- [ ] **Parse-phase benchmark compares unequal workloads between providers** — Task 4 step 3c times `parseBatchChunk(allFiles)` for both TS and WASM as the "parse-phase" metric. But `TsParserProvider.parseBatchChunk` only does frontmatter+scan (see `parser-provider.ts:30`) while `NativeParserProvider.parseBatchChunk` also pre-computes inline tokens for every list item (see `lib.rs:92-96`). The WASM path does ~20× more computation per file in this call. This makes the "parse-phase" speedup metric harder to interpret — a reader might expect it to measure the same operations. Consider documenting this asymmetry in the benchmark output or adding a "parse-phase equivalent work" column. — `prospect/features/rust-parser/slices/rust-parser-08-benchmarks/tasks.md:72`

### Suggestions (think about these, optional)
- [ ] **No warmup iteration before timing runs** — Task 4 uses "3 iterations, take median" for batch/full-index. WASM modules may undergo tiered JIT compilation on first invocation (especially on V8). Consider adding 1 warmup iteration (discarded) before the timed runs to ensure consistent measurement. — `prospect/features/rust-parser/slices/rust-parser-08-benchmarks/tasks.md:72-73`
- [ ] **Graph equivalence check is node-count only; consider edge count** — Spec scenario "Full indexing benchmark at 2000 notes" asserts "resulting graphs from both providers have the same node count (structural equivalence)". Two graphs with the same node count could have different edge structures. Adding `graph.size` (edge count) comparison would strengthen the sanity check without significant cost. — `prospect/features/rust-parser/slices/rust-parser-08-benchmarks/spec.md:64`

### Confirmed Coverage
- [x] **Acceptance criteria complete and traceable** — All 10 ACs map to specific tasks (1→AC2/9, 2→AC2, 3→AC5/6, 4→AC1/3/4/5/6, 5→AC7/8, 6→AC10)
- [x] **Feature alignment: slice scope matches planned sequence** — Slice 08 correctly delivers only benchmark infrastructure, no optimization or CI work (those are slice 09 and non-goals)
- [x] **VaultScanner interface correctness** — Task 2's MockVaultScanner matches the actual interface at `packages/core/src/graph/scanner.ts` (walkVault→WalkResult, readFile→{content,mtime})
- [x] **CountingProviderWrapper correctly targets provider method calls** — `builder.ts:129` uses `provider.parseTokens.bind(provider)` for canvas; the wrapper intercepts this. Batch path at lines 116-118 calls `indexSinglePage` without parseTokensFn, so the default TS import is used but short-circuited by `precomputedTokens` — wrapper never sees these non-calls. The zero-crossing assertion is architecturally sound.
- [x] **ParserProvider interface available for benchmark use** — `ParserProvider` is exported from `@mdtree/core/index.ts:35`, `TsParserProvider` at line 36, `buildGraphFromScanner` at line 31, `NativeParserProvider` from `packages/parser-native/ts/index.ts:32`
- [x] **WASM artifact path assumption valid** — `packages/parser-native/pkg/parser_native_bg.wasm` exists (confirmed via Glob), consistent with Task 4 step 1 and spec preconditions
- [x] **Deterministic generation requirement** — Task 1 specifies "deterministic seeding (simple LCG or index-based)" matching spec scenario "Deterministic generation"
- [x] **Existing tests unaffected** — Slice adds only new files under `packages/parser-native/bench/` and modifies only `package.json` scripts; no existing code changes
- [x] **Zero-crossing assertion design** — Synthetic vault has no canvas files → `parseTokensCalls === 0`; batch path populates `precomputedTokens` on all items → `indexSinglePage` never falls through to parseTokensFn; this matches the implementation at `indexer.ts:54` and `builder.ts:116-118`
- [x] **Non-goals correctly exclude CI** — Proposal explicitly excludes "CI integration of benchmarks (that's slice 09)", avoiding scope creep