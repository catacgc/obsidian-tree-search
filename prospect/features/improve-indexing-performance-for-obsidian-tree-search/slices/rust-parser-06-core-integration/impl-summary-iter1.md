## Summary
- Tasks completed:
  1. ✅ Modified `indexSinglePage` to accept `parseTokensFn` parameter and use `precomputedTokens`/`precomputedParentTokens`
  2. ✅ Modified `buildNodesFromTextLines` and `parseCanvasData` to accept and thread `parseTokensFn`
  3. ✅ Modified `buildGraphFromScanner` with chunked batch path, error recovery (per-file retry on batch failure), and fallback
  4. ✅ Modified `reindexFileInGraph` to accept optional `ParserProvider`
  5. ✅ Wrote 9 builder-provider integration tests (batch path, graph equivalence, chunking, canvas, reindex, error recovery, partial failure, default chunk size)
  6. ✅ Wrote 6 indexer-precomputed tests (precomputedTokens precedence, fallback, precomputedParentTokens, custom parseTokensFn)
- Tests: pass — 252 total (147 core + 105 parser-native), 0 failures
- Commits: `feat(core): wire ParserProvider into graph-building pipeline`