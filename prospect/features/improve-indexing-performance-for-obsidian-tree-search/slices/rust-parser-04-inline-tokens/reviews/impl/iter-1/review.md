### Critical (must fix before archiving)
(none)

### Warnings (should address or explicitly defer)
(none)

### Suggestions (consider before or after archiving)
(none)

### Verified
- [x] AC1: `batch_parse_chunk(json_input: &str) -> String` exported via `#[wasm_bindgen]` — confirmed at `packages/parser-native/src/lib.rs:44-49`
- [x] AC2: `parse_single_file(content, path, mtime, archive_tag) -> String` exported via `#[wasm_bindgen]` — confirmed at `packages/parser-native/src/lib.rs:51-61`
- [x] AC3: Batch internally calls `parse_frontmatter`, `scan_markdown`, and `parse_tokens` for every list item's `rawText` — confirmed at `lib.rs:67,88,92-96`
- [x] AC4: `precomputedParentTokens` computed for frontmatter values containing `[[` — confirmed at `lib.rs:115,227-258` with recursive scanning of strings, arrays, and objects
- [x] AC5: `DvList` has optional `precomputedTokens?: ParsedTextToken[]` — confirmed at `packages/core/src/graph/types.ts:168`
- [x] AC6: `DvPage` has optional `precomputedParentTokens?: Map<string, ParsedTextToken[]>` — confirmed at `packages/core/src/graph/types.ts:183`
- [x] AC7: `adaptBatchResult` correctly deserializes with tokens and `Record→Map` conversion — confirmed at `packages/parser-native/ts/adapter.ts:106-141`
- [x] AC8: `NativeParserProvider.parseBatchChunk` returns `DvPage[]` with `precomputedTokens` on every list item — confirmed at `packages/parser-native/ts/index.ts:35-39`
- [x] AC9: `NativeParserProvider.parseTokens` delegates to standalone WASM function — confirmed at `packages/parser-native/ts/index.ts:41-44`
- [x] AC10: `NativeParserProvider.parseVaultFile` returns `DvPage` with pre-computed tokens — confirmed at `packages/parser-native/ts/index.ts:46-49`
- [x] AC11: Conformance test: native batch output (stripped) equals TS output for all fixtures — confirmed at `batch-api.test.ts:76-94`
- [x] AC12: Conformance test: each `DvList.precomputedTokens` matches `TsParserProvider.parseTokens(item.rawText)` — confirmed at `batch-api.test.ts:97-120`
- [x] AC13: `cargo test` passes ≥15 new Rust batch tests — confirmed: 25 tests at `lib.rs:261-603`
- [x] AC14: All existing TypeScript tests continue to pass (type additions are optional/backward-compatible) — confirmed by completion report (237 TS tests)
- [x] AC15: `WasmExports` and `NativeParserHandle` include `batch_parse_chunk` and `parse_single_file` — confirmed at `loader.ts:6-7` and `index.ts:13-14`
- [x] AC16: `chunkedBatch` async utility exported with configurable chunk size (default 50) and event-loop yielding between chunks — confirmed at `index.ts:69-83`
- [x] Root-only filtering in batch output matches TS `vault-file.ts:40` — confirmed at `lib.rs:98-106`
- [x] Children recursively carry `precomputedTokens` — confirmed at `lib.rs:156-159,185-188` and test at line 341-353
- [x] `parse_single_file_matches_batch` test uses actual WASM entry points — confirmed fixed at `lib.rs:516-547`, calls both `batch_parse_chunk` and `parse_single_file`, deserializes JSON, and asserts equality
- [x] `indexSinglePage` uses `item.precomputedTokens ?? parseTokensFn(item.rawText)` — confirmed at `indexer.ts:54`
- [x] `indexSinglePage` uses `page.precomputedParentTokens?.get(parent) ?? parseTokensFn(parent)` — confirmed at `indexer.ts:242`
- [x] `buildGraphFromScanner` accepts optional `ParserProvider` and `chunkSize` — confirmed at `builder.ts:56-60`
- [x] Batch path with error retry per-file on failure — confirmed at `builder.ts:99-114`
- [x] Canvas files use `provider.parseTokens.bind(provider)` — confirmed at `builder.ts:129`
- [x] `reindexFileInGraph` accepts and uses optional provider — confirmed at `builder.ts:153-175`
- [x] `IndexedTree.setParserProvider` and usage in `refresh`/`refreshPage` — confirmed at `src/indexing/indexed-tree.ts:17-18,41,61`
- [x] WASM loading with graceful fallback — confirmed at `src/indexing/load-native-parser.ts:13-23`
- [x] esbuild inline WASM plugin — confirmed at `esbuild.config.mjs:12-28`
- [x] `@mdtree/core` remains I/O-free — confirmed: no WASM loading or file I/O in core package
- [x] No TODOs/FIXMEs introduced — confirmed via grep
- [x] `ParserProvider` interface and `TsParserProvider` properly exported from `@mdtree/core/index.ts` — confirmed at `packages/core/src/index.ts:35-36`
- [x] `serde(rename_all = "camelCase")` on all batch output types ensures correct JSON field names — confirmed at `types.rs:10,21,29,40,46,52,58`
- [x] `DvList.parent` null→undefined conversion in adapter — confirmed at `adapter.ts:151`
- [x] `BatchFileInput` deserialization handles `archiveTag` camelCase correctly — confirmed via `#[serde(rename_all = "camelCase")]` at `types.rs:10`