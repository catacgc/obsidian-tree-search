### Critical (must fix before archiving)
(none)

### Warnings (should address or explicitly defer)
- [ ] **Rust test `parse_single_file_matches_batch` is trivially true and doesn't test actual WASM entry points** — The test at `packages/parser-native/src/lib.rs:516-539` calls `process_single_file` twice with the same input and compares the JSON output. This is always true by construction (same function, same input). It does NOT test the `parse_single_file` WASM entry point vs `batch_parse_chunk` WASM entry point (which is the actual acceptance criterion about single-file vs batch equivalence). The TS test at `batch-api.test.ts:140-152` does properly test this, but the Rust test is misleading about what it verifies. — `packages/parser-native/src/lib.rs:516-539`

### Suggestions (consider before or after archiving)
- [ ] **`find_tokens_for_item` uses O(N) linear scan per item — consider HashMap lookup by line** — The function at `packages/parser-native/src/lib.rs:211-224` iterates the entire flat list for each item to find a matching `line` number. While this is correct and acceptable for typical file sizes (~20 items), an alternative would be to build a `HashMap<usize, usize>` (line → index) once and look up in O(1). This is a minor performance nit for extremely large files. — `packages/parser-native/src/lib.rs:211-224`
- [ ] **`adaptBatchPage` sets `precomputedParentTokens: undefined` when map is empty rather than omitting the field** — At `packages/parser-native/ts/adapter.ts:140`, when `parentTokens.size === 0`, the function explicitly sets `precomputedParentTokens: undefined`. This is semantically fine (the field is optional), but it adds a property with value `undefined` to the object rather than omitting it. This is consistent with the behavior expected by consumers, so it's not a bug, just a note that `'precomputedParentTokens' in page` would return `true` for native-parsed pages without links. — `packages/parser-native/ts/adapter.ts:140`

### Verified
- [x] AC1: `lib.rs` exports `batch_parse_chunk(json_input: &str) -> String` via `#[wasm_bindgen]` — confirmed at `packages/parser-native/src/lib.rs:44-49`
- [x] AC2: `lib.rs` exports `parse_single_file(content, path, mtime, archive_tag) -> String` via `#[wasm_bindgen]` — confirmed at `packages/parser-native/src/lib.rs:51-61`
- [x] AC3: Batch internally calls `parse_frontmatter`, `scan_markdown`, and `parse_tokens` on every list item's `rawText` — confirmed at `packages/parser-native/src/lib.rs:67,88,94`
- [x] AC4: `precomputedParentTokens` computed for frontmatter values containing `[[` — confirmed at `packages/parser-native/src/lib.rs:115,227-258`
- [x] AC5: `DvList` has optional `precomputedTokens?: ParsedTextToken[]` field — confirmed at `packages/core/src/graph/types.ts:168`
- [x] AC6: `DvPage` has optional `precomputedParentTokens?: Map<string, ParsedTextToken[]>` field — confirmed at `packages/core/src/graph/types.ts:183`
- [x] AC7: `adaptBatchResult` correctly deserializes batch output with tokens and Map conversion — confirmed at `packages/parser-native/ts/adapter.ts:106-141`
- [x] AC8: `NativeParserProvider.parseBatchChunk` returns `DvPage[]` with `precomputedTokens` populated — confirmed at `packages/parser-native/ts/index.ts:35-39` + Rust populates field
- [x] AC9: `NativeParserProvider.parseTokens` delegates to WASM standalone function — confirmed at `packages/parser-native/ts/index.ts:41-44`
- [x] AC10: `NativeParserProvider.parseVaultFile` returns `DvPage` with pre-computed tokens — confirmed at `packages/parser-native/ts/index.ts:46-49`
- [x] AC11: Conformance test comparing native vs TS output across all fixtures — confirmed at `packages/parser-native/ts/__tests__/batch-api.test.ts:76-94`
- [x] AC12: Conformance test verifying `precomputedTokens` matches standalone `parseTokens` — confirmed at `packages/parser-native/ts/__tests__/batch-api.test.ts:97-120`
- [x] AC13: Rust tests ≥15 — confirmed 25 batch tests at `packages/parser-native/src/lib.rs:261-595`
- [x] AC14: Existing tests unaffected by type additions — confirmed by prior completion agent (226 TS tests pass)
- [x] AC15: `WasmExports` and `NativeParserHandle` include `batch_parse_chunk` and `parse_single_file` — confirmed at `packages/parser-native/ts/loader.ts:6-7` and `packages/parser-native/ts/index.ts:13-14`
- [x] AC16: `chunkedBatch` async utility exported with configurable chunk size and yielding — confirmed at `packages/parser-native/ts/index.ts:69-83`
- [x] Root-only filtering in batch output — confirmed at `packages/parser-native/src/lib.rs:99-106`, matching TS `vault-file.ts:40`
- [x] Children recursively have `precomputedTokens` — confirmed at `packages/parser-native/src/lib.rs:156-159,187-188` + test at line 341-353
- [x] `ParserProvider` interface properly exported from `@mdtree/core` — confirmed at `packages/core/src/index.ts:35-36`
- [x] No TODOs/FIXMEs introduced — confirmed via grep
- [x] `@mdtree/core` remains I/O-free — confirmed: no WASM loading logic in core, `ParserProvider` is a pure interface
- [x] `mod types;` declared in `lib.rs` — confirmed at `packages/parser-native/src/lib.rs:7`
- [x] Batch and single-file serialization fallbacks handle errors gracefully — confirmed at `lib.rs:48,60`
- [x] `serde(rename_all = "camelCase")` on all batch output types — confirmed at `packages/parser-native/src/types.rs:10,21,29,40,46,52,58`