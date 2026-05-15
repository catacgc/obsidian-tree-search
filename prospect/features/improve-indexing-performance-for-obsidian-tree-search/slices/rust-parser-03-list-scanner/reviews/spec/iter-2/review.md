### Critical (must fix before implementation)
(none)

### Warnings (should address, discuss if not)
(none)

### Suggestions (think about these, optional)
(none)

### Confirmed Coverage
- [x] **[Previously Critical] Text decoration token structure contradicts TS parser behavior** — fully resolved. The revised artifacts now correctly specify the two-token pattern throughout:
  - `proposal.md:41` — In-Scope section explicitly describes the two-token behavior: `**bold**` → `{ text: "", decoration: "bold" }` + `{ text: "bold text", decoration: "none" }`
  - `proposal.md:69` — AC 11 specifies two-token pattern for bold/italic/strikethrough and single-token for code
  - `tasks.md:117-134` — Task 2 Step 4 items 6-8 correctly emit TWO tokens with empty-text opener, and "Critical: Two-token pattern" section (lines 125-134) with explicit explanation referencing `inline-tokens.ts:106-116`
  - `tasks.md:219-228` — Task 4 tests 22-31 all use correct two-token expectations
  - `spec.md:123-193` — "Text Decoration Parsing (Two-Token Pattern)" requirement with 9 scenarios, all correct
- [x] **[Previously Warning] No task adds regex dependency** — fully resolved. `proposal.md:54` Non-Goals explicitly states "Adding a `regex` crate dependency (hand-written parsers are used...)". `proposal.md:82` AC 24 explicitly requires no regex crate. `tasks.md:72,86` Steps 1-2 explicitly say "hand-written parser with capture" extending existing patterns from `list_scanner.rs`. The single reference to "regex" (line 83) is clearly documenting the TS regex as a reference pattern.
- [x] **[Previously Warning] ImageToken.alt always a string** — fully resolved. `tasks.md:7,40` — Task 1 uses `alt: String` (not `Option<String>`) with comment "ALWAYS present (never Option)". `proposal.md:67` AC 9 says "alt is ALWAYS a string (never omitted)". `proposal.md:81` AC 23 clarifies "`ImageToken.alt` is ALWAYS present as a string (using `Some("")` for empty alt, never `None`)". `tasks.md:207` test 14 uses `alt: ""`. `spec.md:98` scenario says "alt MUST be `""` (empty string, NEVER absent/null)".
- [x] **[Previously Suggestion] Task 4 test 21 has incorrect expected text** — fully resolved. `tasks.md:216` now correctly says `text(") more")` including the `)` in the text token.
- [x] **[Previously Suggestion] Hand-written parser approach documented in Task 2** — fully resolved. Both Task 2 steps explicitly say "hand-written parser with capture" and reference the existing `find_meta_action_end` (line 74) and `find_meta_mdtree_end` (line 88) patterns from `list_scanner.rs` as templates to extend.
- [x] **Feature alignment** — slice correctly scoped to standalone `parse_tokens` function without batch/integration (which are slices 05-06)
- [x] **WASM export pattern** — consistent with existing `parse_frontmatter` and `scan_markdown` in `lib.rs`
- [x] **TypeScript adapter pattern** — consistent with existing `adaptFrontmatter` and `adaptScanResult` in `adapter.ts`
- [x] **NativeParserHandle/WasmExports extension** — matches existing patterns in `loader.ts` and `index.ts`
- [x] **resolveReference behavior** — correctly documented as `split("/")[1]` (index 1, not last) with deep folder test case
- [x] **Meta extraction ordering** — correctly specifies extract → remove → trim → inline parse → append meta tokens
- [x] **Conformance test approach** — ground truth validation against TS `parseTokens` on fixture-derived and synthetic inputs