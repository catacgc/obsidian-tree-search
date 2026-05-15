### Critical
(none)

### Warnings
(none)

### Suggestions
(none)

### Confirmed Coverage
- [x] **[Previously Warning] Batch API output ambiguity regarding pre-computed inline tokens** — fully resolved. The revised design (iteration 3, step 6) now explicitly and unambiguously specifies:
  - Key Decision 1: `DvList` gains `precomputedTokens?: ParsedTextToken[]` field populated by the Rust batch parser
  - Key Decision 2: `DvPage` gains `precomputedParentTokens?: Map<string, ParsedTextToken[]>` for frontmatter parent strings
  - Key Decision 3: The Rust `batch_parse_chunk` JSON output embeds tokens for EVERY `DvList.rawText` AND every frontmatter parent string within a single WASM call
  - Key Decision 4: `indexSinglePage` resolves tokens via `item.precomputedTokens ?? parseTokensFn(item.rawText)` at line 53 and `page.precomputedParentTokens?.get(parent) ?? parseTokensFn(parent)` at line 238
  - The "WASM Boundary Crossing Analysis" table quantifies exactly 0 per-list-item WASM calls during batch flow (down from ~43,000), with only ~340 total crossings for a 2000-note vault
  - The JSON output schema concretely shows `precomputedTokens` embedded in each list item structure
  - The `TsParserProvider` explicitly does NOT populate these fields (leaves undefined), so the TS fallback path still calls `parseTokensFn` per-item as before
  - The `ParserProvider` interface JSDoc explicitly documents that `parseBatchChunk` "returns DvPage[] where EACH DvList item has `precomputedTokens` populated"
  - The proposal acceptance criteria explicitly state: "For a 2,000-note vault batch flow, graph construction makes ZERO individual `parseTokens` WASM calls for .md files"