### Critical (must fix before implementation)
(none)

### Warnings (should address, discuss if not)
- [ ] **Task 2 "Key details" incorrectly claims `scan_markdown` returns only root items** — Line 71 of `tasks.md` states: "The `ScanResult.lists` from `scan_markdown` already has children wired via the `wire_children` post-pass and returns only root items." This is factually wrong — `scan_markdown` returns ALL items in a flat vec (see `packages/parser-native/src/list_scanner.rs:467`: `ScanResult { lists, headers }` with no filtering). Step 7 correctly instructs the implementer to filter to root-only, but the misleading "Key details" bullet could cause confusion about whether step 7 is actually necessary. — `tasks.md:71`

### Suggestions (think about these, optional)
- [ ] **Consider computing `precomputedTokens` only on root items + their nested children, not the full flat list** — Task 2 step 6 says "Converts `Vec<DvListItem>` to `Vec<BatchDvListItem>`" (all items) then step 7 "Filters to root items only." After `wire_children`, non-root items in the flat list are discarded copies — computing their tokens is wasted work (~50% of items). More efficient: filter to roots first, then recursively convert. — `tasks.md:36-37` (steps 6-7)
- [ ] **Spec doesn't exercise the `parse_single_file` fallback path for invalid/empty content** — Scenarios only test valid markdown. Consider adding: "Given a file with no content, When `parse_single_file("", path, mtime, archiveTag)` is called, Then it returns a valid page structure with empty lists and headers." The Rust test (task 3, test 13) covers this, but the spec lacks it as a behavioral requirement. — `spec.md:58-75` (Single File Parse requirement)

### Confirmed Coverage
- [x] **Acceptance criteria → tasks traceability** — all 16 ACs have clear corresponding tasks
- [x] **Pre-computed tokens on all list items (including nested children)** — Task 2 step 6 explicitly says "Recursively converts children too"; Task 3 test 5 verifies; Spec scenario "Root-only list items in output" requires children have `precomputedTokens`
- [x] **`precomputedParentTokens` correctly scans ALL frontmatter values for `[[`** — Task 2 step 8 handles string values, array elements, and nested objects; Task 3 tests 6-8 cover all cases; addresses the user-configurable `parentRelation` concern from prior findings
- [x] **JSON → Map conversion for `precomputedParentTokens`** — Task 5 explicitly states conversion from `Record<string, ParsedTextToken[]>` to `Map<string, ParsedTextToken[]>`
- [x] **Type extensions are backward-compatible** — `precomputedTokens` and `precomputedParentTokens` are both optional fields; existing code constructing `DvList` objects (`list-scanner.ts:129-144`) will compile without changes; AC14 ensures all existing tests pass
- [x] **Chunked batch with yielding** — Task 6 `chunkedBatch` utility correctly yields only between chunks (not after the last), matches spec scenarios for single-chunk no-yield and multi-chunk yield
- [x] **Slice scope appropriately bounded** — explicitly excludes `builder.ts`, `indexer.ts`, `text-lines.ts`, `canvas.ts` modifications (deferred to slice 06)
- [x] **Conformance test strategy** — Task 7 compares native vs TS output (stripped of precomputed fields) for structural equality, plus validates `precomputedTokens` match standalone `parseTokens` calls
- [x] **Single-file vs batch equivalence** — Spec scenario and Task 7 test 4 verify `parse_single_file` matches single-element batch output
- [x] **Feature alignment** — slice delivers exactly what the feature design's Key Decisions 1-3 specify (pre-computed tokens on DvList and DvPage)
- [x] **Dependencies met** — slices 01-04 verified complete (scaffold, frontmatter, list_scanner, inline_tokens all implemented and tested)