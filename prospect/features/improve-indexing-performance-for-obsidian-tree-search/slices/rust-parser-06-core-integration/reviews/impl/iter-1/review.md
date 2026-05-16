### Critical (must fix before archiving)
(none)

### Warnings (should address or explicitly defer)
- [ ] **Redundant `.bind(provider)` called on every loop iteration** — In the `otherFiles` loop at `builder.ts:135`, `provider.parseTokens.bind(provider)` creates a new bound function on each iteration. This should be hoisted before the loop (`const boundParseTokens = provider.parseTokens.bind(provider)`) to avoid unnecessary allocations per file. Same pattern at `builder.ts:169` in `reindexFileInGraph`. — `packages/core/src/graph/builder.ts:135,169`

### Suggestions (consider before or after archiving)
- [ ] **Unused import `getKey` in indexer.ts** — `getKey` is imported at line 3 but never referenced in the file. This may be pre-existing dead code, but since this slice modified the file's logic significantly, it's worth cleaning up. — `packages/core/src/graph/indexer.ts:3`
- [ ] **`chunkedBatch` utility from slice 05 has no consumer** — `packages/parser-native/ts/index.ts:69-83` exports `chunkedBatch` which was designed for this exact use case, but `buildGraphFromScanner` implements its own inline chunking logic (for good reasons: per-page error handling, interleaved indexing). Consider documenting why `chunkedBatch` exists or marking it as a utility for external consumers. — `packages/parser-native/ts/index.ts:69-83`

### Verified
- [x] **AC1: `buildGraphFromScanner` accepts optional `ParserProvider` (3rd) and `chunkSize` (4th, default 50)** — confirmed at `packages/core/src/graph/builder.ts:56-61`
- [x] **AC2: Batch path processes .md files via `parseBatchChunk` in chunks with yielding** — confirmed at `packages/core/src/graph/builder.ts:89-126`
- [x] **AC3: Canvas files use `provider.parseTokens`** — confirmed at `packages/core/src/graph/builder.ts:135`
- [x] **AC4: Fallback path unchanged (file-by-file, yield every 10)** — confirmed at `packages/core/src/graph/builder.ts:138-146`
- [x] **AC5: `reindexFileInGraph` accepts optional `ParserProvider`** — confirmed at `packages/core/src/graph/builder.ts:152-174`
- [x] **AC6: `indexSinglePage` accepts optional `parseTokensFn` defaulting to TS `parseTokens`** — confirmed at `packages/core/src/graph/indexer.ts:204-208`
- [x] **AC7: `precomputedTokens` takes precedence at line 54** — confirmed at `packages/core/src/graph/indexer.ts:54`
- [x] **AC8: `precomputedParentTokens` takes precedence at line 242** — confirmed at `packages/core/src/graph/indexer.ts:241-243`
- [x] **AC9: `buildNodesFromTextLines` accepts optional `parseTokensFn`** — confirmed at `packages/core/src/parser/text-lines.ts:16-22`
- [x] **AC10: `parseCanvasData` accepts optional `parseTokensFn` and threads to `buildNodesFromTextLines`** — confirmed at `packages/core/src/parser/canvas.ts:199-223`
- [x] **AC11: All existing tests pass without modification (backward compatible)** — confirmed: existing call sites pass fewer args; defaults match pre-slice behavior
- [x] **AC12: Test verifies `precomputedTokens` takes precedence** — confirmed at `packages/core/src/__tests__/indexer-precomputed.test.ts:15-29`
- [x] **AC13: Test verifies `precomputedParentTokens` takes precedence** — confirmed at `packages/core/src/__tests__/indexer-precomputed.test.ts:42-57`
- [x] **AC14: Test verifies batch path calls `parseBatchChunk` and produces same graph** — confirmed at `packages/core/src/__tests__/builder-provider.test.ts:61-91`
- [x] **AC15: Test verifies canvas uses provider's `parseTokens`** — confirmed at `packages/core/src/__tests__/builder-provider.test.ts:116-136`
- [x] **AC16: Error recovery: `parseBatchChunk` failure retries per-file** — confirmed at `packages/core/src/graph/builder.ts:101-113`
- [x] **AC17: Test verifies batch failure triggers per-file retry** — confirmed at `packages/core/src/__tests__/builder-provider.test.ts:168-230`
- [x] **`ParserProvider` interface defined in core** — confirmed at `packages/core/src/parser/parser-provider.ts:12-21`
- [x] **`TsParserProvider` implements interface** — confirmed at `packages/core/src/parser/parser-provider.ts:28-40`
- [x] **`DvList.precomputedTokens` optional field added** — confirmed at `packages/core/src/graph/types.ts:168`
- [x] **`DvPage.precomputedParentTokens` optional field added** — confirmed at `packages/core/src/graph/types.ts:183`
- [x] **Core exports updated (`ParserProvider`, `TsParserProvider`, `createTsParserProvider`)** — confirmed at `packages/core/src/index.ts:35-36`
- [x] **Threading through `createSubtree` → `createTreeFromTextLine` → `createNodeFromText`** — confirmed at `packages/core/src/graph/indexer.ts:255-264, 97-103, 48-53`
- [x] **Canvas threading: `parseCanvasData` → `buildNodesFromTextLines` → `createNodeForLine` → `createTextNode`** — confirmed at `packages/core/src/parser/canvas.ts:219-223`, `packages/core/src/parser/text-lines.ts:26,36,54,85`
- [x] **No TODOs/FIXMEs introduced** — confirmed via grep
- [x] **Existing callers unaffected** — confirmed: `indexed-tree.ts:29,43`, `cli/indexer.ts:18,33` pass only 2-4 args (new params are trailing optional)