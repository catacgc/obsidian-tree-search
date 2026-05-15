## Summary

- Tasks completed:
  1. ✅ **Task 1** — Created `inline_tokens.rs` with serde output types (`ParsedToken` enum), declared `mod inline_tokens` in `lib.rs`
  2. ✅ **Task 2** — Implemented `parse_tokens` function body: meta-action extraction (hand-written parser), meta-mdtree extraction (hand-written parser), trim, inline state machine (obsidian links, markdown links, images, HTTP URLs, bold/italic/strikethrough/code, softbreak, plain text)
  3. ✅ **Task 3** — Added `#[wasm_bindgen]` export `parse_tokens` in `lib.rs`, updated `WasmExports` and `NativeParserHandle` types in TS
  4. ✅ **Task 4** — 44 Rust unit tests covering all token types, emphasis edge cases, resolveReference, and meta extraction
  5. ✅ **Task 5** — Implemented `adaptParseTokens` in `adapter.ts` and updated `index.ts` exports
  6. ✅ **Task 6** — 27 TypeScript conformance tests (8 fixture-derived + 19 synthetic) comparing Rust vs TS output

- Tests: **pass** — 105 Rust tests (44 inline + 41 list scanner + 17 frontmatter + 3 other), 220 TypeScript tests total across 14 files

- Commits:
  1. `feat(parser-native): implement inline token parser in Rust (slice 04)` — Main implementation
  2. `fix(parser-native): handle markdown-it emphasis edge cases correctly` — Bold text padding, underscore word boundaries, balanced parens, no-space URLs
  3. `fix(parser-native): add softbreak (newline) handling to inline parser` — Newline → empty text token