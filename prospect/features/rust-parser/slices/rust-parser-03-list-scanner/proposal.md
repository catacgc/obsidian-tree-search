# Slice Proposal: rust-parser-03-list-scanner

## Problem & Outcome

**Problem:** The TypeScript `scanMarkdown` function in `packages/core/src/parser/list-scanner.ts` performs line-by-line regex matching across every markdown file in the vault — detecting headers, list items, indent nesting, tags, tasks, and meta-action syntax. On mobile (where the JS engine is significantly slower), this is one of the three hot-path operations (along with frontmatter and inline-token parsing) that makes indexing noticeably slow. Slice 02 delivered the Rust frontmatter parser; this slice tackles the second major parser component.

**Outcome:** A Rust implementation of `scanMarkdown` that produces structurally identical `DvList[]` and `HeadingCache[]` output, callable via the existing WASM infrastructure from slice 01. This prepares the path for the batch API (slice 05) where the scanner will run as part of the full-file parse pipeline within a single WASM boundary crossing.

## What Changes

1. A new Rust module `packages/parser-native/src/list_scanner.rs` implementing the full `scanMarkdown` algorithm
2. A `#[wasm_bindgen]` export `scan_markdown(content, file_path, frontmatter_body_start, archive_tag) → JSON` in `lib.rs`
3. A TypeScript adapter function `adaptScanResult(json) → { lists: DvList[], headers: HeadingCache[] }` in the existing `adapter.ts`
4. Rust unit tests covering all behaviors from the existing `list-scanner.test.ts`
5. TypeScript conformance tests comparing Rust vs TS output on integration fixtures

## Scope (In-scope)

- Rust implementation of header detection (`/^(#{1,6})\s+(.*)/`)
- Rust implementation of list item detection (`/^(\s*)(?:[-*+]|\d+\.)\s+(.*)/`)
- Task detection (`/^\[([ xX])\]\s+(.*)/`)
- Inline tag extraction (`/#([\w/]+)/g`)
- Meta-action stripping from text (preserving in rawText)
- Meta-mdtree stripping from text (preserving in rawText)
- `shouldSkip` logic (archive tag filtering, pure-prose detection)
- Indent stack management for parent/child wiring
- Header stack management for section.subpath tracking
- Post-pass: wiring `.children` from `.parent` line refs
- Frontmatter body-start line offset calculation
- JSON serialization of results via serde
- TypeScript adapter deserialization
- Conformance tests against all existing test fixtures

## Non-goals

- Modifying the `parseVaultFile` function to use the Rust scanner (that's slice 06)
- Implementing the batch API (that's slice 05)
- Inline token parsing (that's slice 04)
- Modifying any graph construction logic
- Changing the `DvList` or `HeadingCache` type definitions

## Feature Mapping

- **Source feature:** `rust-parser` (WASM-based parser for indexing performance)
- **Slice item:** `rust-parser-03-list-scanner`

## Acceptance Criteria

1. `packages/parser-native/src/list_scanner.rs` exists with a public `scan_markdown` function
2. `cargo test` passes all Rust unit tests for the list scanner (≥20 tests)
3. The Rust scanner correctly detects ATX headers (levels 1-6) and records line positions
4. The Rust scanner detects list items with `-`, `*`, `+`, and numbered (`\d+.`) prefixes
5. Task markers `[ ]`, `[x]`, `[X]` are detected, setting `task=true` and appropriate `completed` value
6. The task marker prefix is stripped from `text` but the remainder (post-task, pre-meta-strip) is stored in `rawText`
7. Inline tags matching `#[\w/]+` are extracted into `DvList.tags`
8. Meta-action syntax `(meta-action-*::...)` is stripped from `text` but preserved in `rawText`
9. Meta-mdtree syntax `(meta-mdtree:: \w+)` is stripped from `text` but preserved in `rawText`
10. Items with `rawText !== text` (meta-actions present) are NOT skipped by `shouldSkip`, even if `text` alone is pure prose
11. Items where `text` is empty after meta stripping ARE skipped
12. The archive tag check correctly skips items whose text contains `#archiveTag`
13. Pure-prose items (no `[[`, `![[`, `#`, or `http`) are skipped
14. Indent stack correctly assigns `parent` line numbers for nested items
15. Indent stack resets on each new header
16. Section `subpath` is set to `#HeaderText` for items below a header, and `""` before any header
17. Post-pass wires `.children` arrays from `.parent` line references
18. The `#[wasm_bindgen]` export `scan_markdown` returns valid JSON deserializable to the expected structure
19. `adaptScanResult` in `adapter.ts` returns `{ lists: DvList[], headers: HeadingCache[] }` matching the TS types
20. Conformance tests run the Rust scanner and TS `scanMarkdown` on ALL integration fixture `.md` files and assert deep equality of results
21. The Rust implementation handles both LF and CRLF line endings
22. `frontmatterBodyStart` offset correctly skips frontmatter lines (body starts at the correct line number)
