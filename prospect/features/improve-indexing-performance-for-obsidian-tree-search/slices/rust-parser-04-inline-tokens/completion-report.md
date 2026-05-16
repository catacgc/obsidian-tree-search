## Completion Checklist

### Tasks
- [x] Task 1 — Create shared Rust output types (`types.rs`) — PASS: All types defined with correct `#[serde(rename_all = "camelCase")]`, `BatchFileInput`, `BatchParsedPage`, `BatchDvListItem` with `precomputed_tokens`, `mod types` in `lib.rs`
- [x] Task 2 — Implement `batch_parse_chunk` and `parse_single_file` Rust functions — PASS: Both exported via `#[wasm_bindgen]` at `lib.rs:44-61`, `process_single_file` combines all three parsers, root-only filtering, recursive token computation, parent token scanning
- [x] Task 3 — Write ≥15 Rust unit tests — PASS: 25 batch tests (lines 261-603) covering all specified scenarios
- [x] Task 4 — Extend `DvList` and `DvPage` types in `@mdtree/core` — PASS: `precomputedTokens?: ParsedTextToken[]` at `types.ts:168`, `precomputedParentTokens?: Map<string, ParsedTextToken[]>` at `types.ts:183`
- [x] Task 5 — Implement `adaptBatchResult` and `adaptSingleResult` TS adapters — PASS: `adapter.ts:106-159`, Record→Map conversion, recursive list item adaptation with `precomputedTokens`
- [x] Task 6 — Implement `NativeParserProvider` and `chunkedBatch` utility — PASS: `index.ts:32-83`, implements `ParserProvider`, `chunkedBatch` with configurable chunk size and yielding
- [x] Task 7 — Write TypeScript conformance tests — PASS: `batch-api.test.ts` with 10 tests covering all 8 required scenarios

### Tests
- [x] Rust: 137 passed, 0 failed — PASS
- [x] TypeScript: 252 passed, 0 failed — PASS

### Code State
- [x] No uncommitted changes to slice code — PASS (3 unrelated pre-existing changes: deleted `.claude/settings.local.json`, modified `.gitignore`, deleted `CLAUDE.md`)
- [x] No TODOs/FIXMEs introduced — PASS

### Acceptance Criteria
- [x] AC1: `batch_parse_chunk(json_input: &str) -> String` exported via `#[wasm_bindgen]` — PASS: `lib.rs:44-49`
- [x] AC2: `parse_single_file` exported via `#[wasm_bindgen]` — PASS: `lib.rs:51-61`
- [x] AC3: Internally calls `parse_frontmatter`, `scan_markdown`, `parse_tokens` per list item — PASS: `lib.rs:67,88,92-96`
- [x] AC4: `precomputedParentTokens` for frontmatter values with `[[` — PASS: `lib.rs:115,227-258`
- [x] AC5: `DvList.precomputedTokens?: ParsedTextToken[]` — PASS: `types.ts:168`
- [x] AC6: `DvPage.precomputedParentTokens?: Map<string, ParsedTextToken[]>` — PASS: `types.ts:183`
- [x] AC7: `adaptBatchResult` correctly deserializes with Record→Map — PASS: `adapter.ts:106-141`
- [x] AC8: `NativeParserProvider.parseBatchChunk` returns `DvPage[]` with tokens — PASS: `index.ts:35-39`
- [x] AC9: `NativeParserProvider.parseTokens` delegates to standalone WASM — PASS: `index.ts:41-44`
- [x] AC10: `NativeParserProvider.parseVaultFile` returns `DvPage` with tokens — PASS: `index.ts:46-49`
- [x] AC11: Conformance: native batch (stripped) equals TS output — PASS: `batch-api.test.ts:76-94`
- [x] AC12: `precomputedTokens` matches `TsParserProvider.parseTokens(item.rawText)` — PASS: `batch-api.test.ts:97-120`
- [x] AC13: `cargo test` ≥15 new Rust batch tests — PASS: 25 tests
- [x] AC14: All existing TS tests pass — PASS: 252 tests, 0 failures
- [x] AC15: `WasmExports` and `NativeParserHandle` include new functions — PASS: `loader.ts:6-7`, `index.ts:13-14`
- [x] AC16: `chunkedBatch` exported with configurable chunk size and yielding — PASS: `index.ts:69-83`

## Verdict
READY FOR ARCHIVE