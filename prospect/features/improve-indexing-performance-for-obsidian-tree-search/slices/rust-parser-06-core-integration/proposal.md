# Slice Proposal: rust-parser-06-core-integration

## Problem & Outcome

**Problem:** Slices 01–05 built the complete Rust WASM parser pipeline: individual parsers (`parse_frontmatter`, `scan_markdown`, `parse_tokens`), the batch API (`batch_parse_chunk`, `parse_single_file`), the `NativeParserProvider` class, and the `chunkedBatch` utility. However, the core graph-building code (`builder.ts`, `indexer.ts`, `text-lines.ts`, `canvas.ts`) still directly imports and calls the TypeScript parser functions. There is no code path that uses the `ParserProvider` interface or reads from `DvList.precomputedTokens` / `DvPage.precomputedParentTokens`. The WASM parser is fully functional but unused by the indexing pipeline.

**Outcome:** After this slice, the `@mdtree/core` graph-building pipeline accepts an optional `ParserProvider` and uses it for all parsing work. `buildGraphFromScanner` uses `parseBatchChunk` in chunks with event-loop yielding for `.md` files, and passes `provider.parseTokens` to the canvas path. `indexSinglePage` resolves inline tokens via `item.precomputedTokens ?? parseTokensFn(item.rawText)` at line 53 and `page.precomputedParentTokens?.get(parent) ?? parseTokensFn(parent)` at line 238. `buildNodesFromTextLines` accepts an optional `parseTokensFn` for canvas text lines. When no provider is passed, all behavior is unchanged (transparent TS fallback). The plugin and CLI can now inject a `ParserProvider` to use the native parser.

## What Changes

1. **`buildGraphFromScanner` signature and batch flow** (`packages/core/src/graph/builder.ts`): Accepts an optional `ParserProvider` and `chunkSize` parameter. When provider is given, reads all `.md` file contents, processes them in chunks via `provider.parseBatchChunk`, calls `indexSinglePage` per result (no per-item WASM calls since `precomputedTokens` is populated), yields between chunks. Processes `.canvas` files individually using `provider.parseTokens`. When no provider is given, behavior is identical to today.

2. **`reindexFileInGraph` signature** (`packages/core/src/graph/builder.ts`): Accepts an optional `ParserProvider`. For `.md` files uses `provider.parseVaultFile()` (returns pre-computed tokens). For `.canvas` files passes `provider.parseTokens` through.

3. **`indexSinglePage` signature** (`packages/core/src/graph/indexer.ts`): Accepts an optional `parseTokensFn` parameter (defaults to imported TS `parseTokens`). At line 53 (`createNodeFromText`): uses `item.precomputedTokens ?? parseTokensFn(item.rawText)`. At line 238 (frontmatter parents): uses `page.precomputedParentTokens?.get(parent) ?? parseTokensFn(parent)`.

4. **`createNodeFromText` internal function** (`packages/core/src/graph/indexer.ts`): Accepts `parseTokensFn` parameter and uses pre-computed tokens when available.

5. **`buildNodesFromTextLines` signature** (`packages/core/src/parser/text-lines.ts`): Accepts an optional `parseTokensFn` parameter. Passes it to `createTextNode`. Defaults to imported TS `parseTokens`.

6. **`createTextNode` internal function** (`packages/core/src/parser/text-lines.ts`): Accepts `parseTokensFn` parameter (defaults to TS `parseTokens`). Uses it at line 82 where it currently calls `parseTokens(text)`.

7. **`parseCanvasData` signature** (`packages/core/src/parser/canvas.ts`): Accepts an optional `parseTokensFn` parameter. Passes it to `buildNodesFromTextLines`.

8. **`indexScannedFile` internal function** (`packages/core/src/graph/builder.ts`): Accepts an optional `parseTokensFn` parameter. Passes it to `parseCanvasData`.

9. **`@mdtree/core/index.ts` exports**: No new exports needed (function signatures change but exports remain the same).

## Scope

**In-scope:**
- Modifying `buildGraphFromScanner` to accept optional `ParserProvider` + chunked batch flow
- Modifying `reindexFileInGraph` to accept optional `ParserProvider`
- Modifying `indexSinglePage` to accept optional `parseTokensFn` and use `precomputedTokens`/`precomputedParentTokens`
- Modifying `buildNodesFromTextLines` to accept optional `parseTokensFn`
- Modifying `parseCanvasData` to accept optional `parseTokensFn`
- Threading `parseTokensFn` through all internal helper functions
- Ensuring all existing tests pass without any provider (transparent TS fallback)
- New tests verifying the provider integration works correctly
- New tests verifying `precomputedTokens` is used when present

**Non-goals (explicitly excluded):**
- Plugin-side changes (`src/main.ts`, `src/indexing/indexed-tree.ts`) — that's slice 07
- CLI-side changes (`packages/cli/src/vault/indexer.ts`) — that's slice 07 or later
- Modifying `@mdtree/parser-native` — it's already complete
- esbuild config changes — slice 07
- Benchmarking — slice 08
- CI workflow — slice 09
- Loading WASM or instantiating `NativeParserProvider` — consumers do this (slice 07)

## Acceptance Criteria

1. `buildGraphFromScanner` accepts an optional `ParserProvider` as its third parameter and an optional `chunkSize` (default 50) as its fourth parameter.
2. When a `ParserProvider` is passed to `buildGraphFromScanner`, `.md` files are processed via `provider.parseBatchChunk` in chunks of `chunkSize`, with `await setTimeout(0)` yielding between chunks.
3. When a `ParserProvider` is passed, `.canvas` files are processed individually with `provider.parseTokens` threaded into `parseCanvasData` → `buildNodesFromTextLines`.
4. When NO `ParserProvider` is passed, `buildGraphFromScanner` behaves identically to the current implementation (file-by-file with yield every 10).
5. `reindexFileInGraph` accepts an optional `ParserProvider`. For `.md` files it uses `provider.parseVaultFile()`. For canvas files it passes `provider.parseTokens` through.
6. `indexSinglePage` accepts an optional fourth parameter `parseTokensFn?: (text: string) => ParsedTextToken[]` defaulting to the imported TS `parseTokens`.
7. At the `createNodeFromText` call site (line 53), tokens are resolved via `item.precomputedTokens ?? parseTokensFn(item.rawText)` — if `precomputedTokens` is populated (native batch), no call to `parseTokensFn` occurs.
8. At the frontmatter parent loop (line 238), tokens are resolved via `page.precomputedParentTokens?.get(parent) ?? parseTokensFn(parent)` — if `precomputedParentTokens` has the key, no call to `parseTokensFn` occurs.
9. `buildNodesFromTextLines` accepts an optional `parseTokensFn` parameter and uses it in `createTextNode` instead of the directly imported `parseTokens`.
10. `parseCanvasData` accepts an optional `parseTokensFn` parameter and threads it to `buildNodesFromTextLines`.
11. All existing tests in `packages/core/src/__tests__/` pass without modification (all call sites default to TS `parseTokens` when no provider/fn is supplied).
12. New tests verify that when `DvList.precomputedTokens` is populated, `indexSinglePage` uses those tokens directly without calling `parseTokensFn`.
13. New tests verify that when `DvPage.precomputedParentTokens` is populated, `indexSinglePage` uses those tokens directly for frontmatter parent resolution.
14. New tests verify `buildGraphFromScanner` with a mock `ParserProvider` correctly calls `parseBatchChunk` and produces the same graph as without a provider.
15. New tests verify canvas files use the provider's `parseTokens` when available.

## Feature Mapping

- **Source feature:** Improve indexing performance for obsidian-tree-search (Rust WASM parser)
- **Slice item:** `rust-parser-06-core-integration`
