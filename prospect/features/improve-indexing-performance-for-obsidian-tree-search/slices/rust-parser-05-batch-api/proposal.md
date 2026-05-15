# Slice Proposal: rust-parser-05-batch-api

## Problem & Outcome

**Problem:** Slices 01–04 established individual Rust parsers (`parse_frontmatter`, `scan_markdown`, `parse_tokens`) each requiring a separate WASM boundary crossing. To parse a single file through the full pipeline (frontmatter + list scan + inline tokens for every list item + inline tokens for every frontmatter parent string), the TypeScript layer must currently make 2 + M individual WASM calls (where M is the number of list items). For a 2,000-note vault with ~20 items/note, this means ~40,000+ boundary crossings, negating the batch optimization. Additionally, no `NativeParserProvider` implementation exists — the `ParserProvider` interface in core has only a `TsParserProvider`.

**Outcome:** After this slice, a single `batch_parse_chunk` WASM function processes multiple files end-to-end in one call (frontmatter → list scan → inline tokens for all `rawText` + frontmatter parents), returning `DvPage[]` with pre-computed `ParsedTextToken[]` attached to every list item and parent string. A `NativeParserProvider` implementation in `@mdtree/parser-native` uses this function and satisfies the `ParserProvider` interface. A TypeScript-side `chunkedBatch` utility splits large file sets into configurable chunks with `await setTimeout(0)` yielding between them, preserving mobile UI responsiveness.

## What Changes

1. A new Rust `types.rs` module (or equivalent) with shared batch output types that mirror the `DvPage` JSON structure, extended with `precomputedTokens` per list item and `precomputedParentTokens` per page.

2. A new `batch_parse_chunk` function in `lib.rs` exported via `#[wasm_bindgen]` — accepts a JSON array of `{path, content, mtime, archiveTag}` file descriptors. For each file: calls `parse_frontmatter`, `scan_markdown`, and `parse_tokens` on every list item's `rawText` and on relevant frontmatter values. Returns a JSON array of page structures with pre-computed tokens embedded.

3. A new `parse_single_file` function in `lib.rs` exported via `#[wasm_bindgen]` — same end-to-end pipeline for a single file (used for incremental reindex).

4. Extended `DvList` type in `packages/core/src/graph/types.ts` with optional `precomputedTokens?: ParsedTextToken[]` field.

5. Extended `DvPage` type in `packages/core/src/graph/types.ts` with optional `precomputedParentTokens?: Map<string, ParsedTextToken[]>` field.

6. New TS adapter functions `adaptBatchResult` and `adaptSingleResult` in `packages/parser-native/ts/adapter.ts` — deserializes batch JSON output into `DvPage[]` with `precomputedTokens` and `precomputedParentTokens` populated.

7. New `NativeParserProvider` class in `packages/parser-native/ts/index.ts` implementing `ParserProvider` using the WASM handle.

8. Updated `WasmExports` and `NativeParserHandle` types to include the new WASM function signatures.

9. New `chunkedBatch` async utility that splits files into chunks, calls `parseBatchChunk` per chunk, and yields between chunks.

10. Conformance tests verifying batch output matches `TsParserProvider` output for all fixture files.

## Scope

**In-scope:**
- Rust `batch_parse_chunk` function combining all three parsers into a single WASM entry point
- Rust `parse_single_file` function for incremental single-file use
- Shared Rust output types (batch page structure with embedded tokens)
- Extending `DvList` with optional `precomputedTokens` field
- Extending `DvPage` with optional `precomputedParentTokens` field
- `adaptBatchResult` and `adaptSingleResult` TypeScript adapter functions
- `NativeParserProvider` class implementing `ParserProvider`
- Extending `WasmExports` and `NativeParserHandle` with new function signatures
- `chunkedBatch` utility for TypeScript-side chunking with yielding
- Conformance tests comparing `NativeParserProvider` vs `TsParserProvider` output
- Rust unit tests for the batch function
- Exporting new symbols from `@mdtree/parser-native` index

**Non-goals (explicitly excluded):**
- Modifying `builder.ts`, `indexer.ts`, `text-lines.ts`, or `canvas.ts` (slice 06)
- Plugin esbuild integration or WASM inlining (slice 07)
- Benchmark harness (slice 08)
- CI workflow for Rust builds (slice 09)
- Changing `TsParserProvider` implementation (it does NOT populate `precomputedTokens`)
- Passing the configurable `parentRelation` field name to Rust — the batch function parses ALL frontmatter keys; consumers decide which field to use at graph construction time

## Acceptance Criteria

1. `lib.rs` exports a `batch_parse_chunk(json_input: &str) -> String` function via `#[wasm_bindgen]` that accepts a JSON array of file descriptors and returns a JSON array of page structures.
2. `lib.rs` exports a `parse_single_file(content: &str, path: &str, mtime: f64, archive_tag: &str) -> String` function via `#[wasm_bindgen]` returning a single page structure JSON.
3. For each file in the batch input, the Rust function internally calls `parse_frontmatter`, `scan_markdown`, and `parse_tokens` on every list item's `rawText`, producing a `precomputedTokens` array per list item.
4. For each file, the Rust function computes `parse_tokens` for every frontmatter string value containing `[[`, returning them in a `precomputedParentTokens` map keyed by the raw string value.
5. `DvList` in `packages/core/src/graph/types.ts` gains the optional field `precomputedTokens?: ParsedTextToken[]`.
6. `DvPage` in `packages/core/src/graph/types.ts` gains the optional field `precomputedParentTokens?: Map<string, ParsedTextToken[]>`.
7. `adaptBatchResult(json: string): DvPage[]` in `adapter.ts` correctly deserializes batch output into `DvPage[]` with `precomputedTokens` on each `DvList` and `precomputedParentTokens` as a `Map` on each `DvPage`.
8. `NativeParserProvider` implements `ParserProvider` — `parseBatchChunk(files)` returns `DvPage[]` where every `DvList` has `precomputedTokens` populated.
9. `NativeParserProvider.parseTokens(text)` returns the same result as the standalone `parse_tokens` WASM export.
10. `NativeParserProvider.parseVaultFile(content, path, mtime, archiveTag)` returns a `DvPage` with `precomputedTokens` populated on all list items.
11. For all existing integration test fixture `.md` files, native batch output (with `precomputedTokens` and `precomputedParentTokens` stripped) is structurally identical (deep equal) to `TsParserProvider` output.
12. For all fixture files, `precomputedTokens` on each `DvList` item matches `TsParserProvider.parseTokens(item.rawText)`.
13. `cargo test` passes with ≥15 new Rust tests covering batch-specific logic.
14. All existing TypeScript tests continue to pass (no regressions from the optional type additions).
15. `WasmExports` and `NativeParserHandle` types include `batch_parse_chunk` and `parse_single_file`.
16. A `chunkedBatch` async utility is exported that splits files into configurable-size chunks, calls `parseBatchChunk` per chunk, yields between chunks, and returns concatenated `DvPage[]`.

## Feature Mapping

- **Source feature:** Improve indexing performance for obsidian-tree-search (Rust WASM parser)
- **Slice item:** `rust-parser-05-batch-api`
