### Accepted
- [ ] [Warning] **Batch API output ambiguity regarding pre-computed inline tokens** — Design Key Decision 10 + WASM API `batch_parse_chunk`. The design implies `indexSinglePage` calls `provider.parseTokens(item.rawText)` individually for every list item after batch parsing, meaning ~100k individual WASM boundary crossings for a 2000-note vault. The `DvList` type (types.ts:152-167) has no `parsedTokens` field, so the batch output structurally cannot include pre-computed tokens without a type change. The design should explicitly state whether `batch_parse_chunk` returns pre-computed inline tokens per list item (collapsing M boundary crossings into zero) or relies on standalone calls (with documented performance implications).

### Dismissed
(none)