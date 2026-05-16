## Completion Checklist

### Tasks
- [x] Task 1 — Modify `indexSinglePage` to accept `parseTokensFn` and use pre-computed tokens — PASS: Signature at `indexer.ts:204-208` with default `parseTokens`, `item.precomputedTokens ?? parseTokensFn(item.rawText)` at line 54, `page.precomputedParentTokens?.get(parent) ?? parseTokensFn(parent)` at line 241-242, threading through `createSubtree`→`createTreeFromTextLine`→`createNodeFromText`.
- [x] Task 2 — Modify `buildNodesFromTextLines` and `parseCanvasData` to accept `parseTokensFn` — PASS: `buildNodesFromTextLines` at `text-lines.ts:16-22` with optional `parseTokensFn` parameter defaulting to `parseTokens`, threaded through `createNodeForLine`→`createTextNode`. `parseCanvasData` at `canvas.ts:199-205` with optional `parseTokensFn`, threaded to `buildNodesFromTextLines` at line 223.
- [x] Task 3 — Modify `buildGraphFromScanner` with chunked batch path and error recovery — PASS: Signature at `builder.ts:56-61`, batch path at lines 73-137, try/catch around `parseBatchChunk` at lines 99-114 with per-file retry, yielding at line 125, `.bind(provider)` hoisted at line 129.
- [x] Task 4 — Modify `reindexFileInGraph` to accept optional `ParserProvider` — PASS: Signature at `builder.ts:153-159`, `.md` uses `provider.parseVaultFile` at line 166, canvas passes `provider.parseTokens.bind(provider)` at line 170.
- [x] Task 5 — Write builder-provider integration tests — PASS: `builder-provider.test.ts` exists with tests for batch path, graph equivalence, chunking, canvas, reindex, error recovery, partial failure.
- [x] Task 6 — Write indexer-precomputed tests — PASS: `indexer-precomputed.test.ts` exists with tests for precomputedTokens precedence, fallback, precomputedParentTokens, custom parseTokensFn.

### Tests
- [x] Full suite: 252 passed, 0 failed — PASS

### Code State
- [x] No uncommitted changes to slice code — PASS (3 unrelated pre-existing changes: deleted `.claude/settings.local.json`, modified `.gitignore`, deleted `CLAUDE.md`)
- [x] No TODOs/FIXMEs introduced — PASS

### Acceptance Criteria
- [x] AC1: `buildGraphFromScanner` accepts optional `ParserProvider` (3rd) and `chunkSize` (4th, default 50) — PASS: `builder.ts:56-61`
- [x] AC2: Batch path processes .md files via `parseBatchChunk` in chunks with yielding — PASS: `builder.ts:88-126`
- [x] AC3: Canvas files use `provider.parseTokens` — PASS: `builder.ts:129,136`
- [x] AC4: Fallback path unchanged (file-by-file, yield every 10) — PASS: `builder.ts:138-148`
- [x] AC5: `reindexFileInGraph` accepts optional `ParserProvider` — PASS: `builder.ts:153-175`
- [x] AC6: `indexSinglePage` accepts optional `parseTokensFn` defaulting to TS `parseTokens` — PASS: `indexer.ts:204-208`
- [x] AC7: `precomputedTokens` takes precedence at line 54 — PASS: `indexer.ts:54`
- [x] AC8: `precomputedParentTokens` takes precedence at line 241-242 — PASS: `indexer.ts:241-242`
- [x] AC9: `buildNodesFromTextLines` accepts optional `parseTokensFn` — PASS: `text-lines.ts:16-22`
- [x] AC10: `parseCanvasData` accepts optional `parseTokensFn` and threads to `buildNodesFromTextLines` — PASS: `canvas.ts:199-205,223`
- [x] AC11: All existing tests pass without modification — PASS: 252/252
- [x] AC12: Test verifies `precomputedTokens` takes precedence — PASS: `indexer-precomputed.test.ts`
- [x] AC13: Test verifies `precomputedParentTokens` takes precedence — PASS: `indexer-precomputed.test.ts`
- [x] AC14: Test verifies batch path and graph equivalence — PASS: `builder-provider.test.ts`
- [x] AC15: Test verifies canvas uses provider's `parseTokens` — PASS: `builder-provider.test.ts`
- [x] AC16: Batch chunk failure triggers per-file retry — PASS: `builder.ts:101-113`
- [x] AC17: Test verifies batch failure triggers per-file retry — PASS: `builder-provider.test.ts` (test output confirms error recovery behavior)

## Verdict
READY FOR ARCHIVE