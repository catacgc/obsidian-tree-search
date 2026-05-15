# Proposal: rust-parser-03-list-scanner

## Problem

The `scanMarkdown` function in `packages/core/src/parser/list-scanner.ts` is the second major hot-path function in the indexing pipeline. For every markdown file in the vault, it performs line-by-line regex matching to detect headers and list items, builds an indent stack for parent-child wiring, extracts inline tags, detects task markers, strips meta-action/meta-mdtree annotations, applies the `shouldSkip` heuristic, and constructs `DvList[]` and `HeadingCache[]` arrays. On mobile, this is a significant contributor to slow indexing. Moving this logic to Rust/WASM (building on the scaffold from slice 01 and the frontmatter parser from slice 02) provides a major parse-phase speedup.

## Outcome

A Rust implementation of `scanMarkdown` compiled to WASM that produces structurally identical `DvList[]` and `HeadingCache[]` output to the TypeScript implementation. The function is exported via `#[wasm_bindgen]` and a TypeScript adapter deserializes the JSON output into the existing `@mdtree/core` types. This is the largest and most complex parser function being migrated, handling the bulk of the structural parsing work.

## Changes

- New Rust module `packages/parser-native/src/list_scanner.rs` implementing `scan_markdown`
- Serde-serializable output types mirroring `DvList` and `HeadingCache` field structures
- `#[wasm_bindgen]` export `scan_markdown` in `lib.rs` returning JSON
- TypeScript adapter function `adaptScanResult` in `packages/parser-native/ts/adapter.ts`
- Extension of `NativeParserHandle` type to include `scan_markdown`
- Extension of `WasmExports` type in `loader.ts`
- Rust unit tests (>=35) and TypeScript conformance tests

## In-Scope

- Header detection (ATX headers `# ` through `###### `) with `.trim()` on heading text
- List item detection (bullet `-`, `*`, `+` and numbered `1.` patterns)
- Task marker detection (`[ ]`, `[x]`, `[X]`) with text extraction after marker
- Indent stack for parent-child line wiring
- Post-pass `.children` population from `.parent` references
- Section subpath tracking from headers (reset indent stack on new header)
- Inline tag extraction (`#tag` and `#tag/subtag` patterns)
- Meta-action stripping from `text` while preserving in `rawText`
- Meta-mdtree stripping from `text` while preserving in `rawText`
- `shouldSkip` heuristic: skip items where `rawText === text` (or `text === ""`) AND text contains none of `[[`, `![[`, `#`, `http`, `- [`
- Archive tag filtering (items whose text includes `#archiveTag` are skipped)
- Frontmatter body-start offset handling (start scanning from the correct line)
- Position fields: `{ start: { line, col }, end: { line, col } }` for DvList, `{ start: { line, ch }, end: { line, ch } }` for HeadingCache
- `.trim()` at three points: initial `listMatch[2].trim()`, `taskMatch[2].trim()`, and post-meta-strip `.trim()`
- `.trim()` on header text (`headerMatch[2].trim()`)

## Non-Goals

- Inline token parsing (`parseTokens`) — that is slice 04
- Batch API or integration with `parseVaultFile` — that is slices 05/06
- Modifications to `@mdtree/core` graph types or builder
- Canvas parsing
- Any changes to the TypeScript `scanMarkdown` implementation (it remains as the fallback)

## Acceptance Criteria

1. `packages/parser-native/src/list_scanner.rs` exists with a public `scan_markdown` function
2. `cargo test` passes all Rust unit tests for the list scanner module (>=35 tests)
3. Header detection: ATX headers (`#` through `######`) produce `HeadingCache` entries with correct `heading` (trimmed), `level`, and `position` (using `ch` field names)
4. List item detection: all bullet types (`-`, `*`, `+`) and numbered lists (`N.`) are recognized
5. Task detection: `[ ]` marks `task: true, completed: false`; `[x]`/`[X]` marks `task: true, completed: true`; task prefix is stripped from text
6. Indent stack wiring: nested items get `parent` set to the parent's line number; sibling items have `parent: undefined`; indent stack resets on de-dent and on new header
7. Children wiring: post-pass populates `.children` arrays from `.parent` references
8. Section subpath: items under a header get `section.subpath` = `#<heading>`; items before any header get `""`; subpath updates on each new header
9. Inline tag extraction: `#tag` and `#path/tag` patterns are extracted into `tags[]` array with `#` prefix
10. Meta-action stripping: `(meta-action-NAME::VALUE)` patterns are removed from `text` but preserved in `rawText`
11. Meta-mdtree stripping: `(meta-mdtree:: WORD)` patterns are removed from `text` but preserved in `rawText`
12. `shouldSkip` logic: items where (`rawText === text` OR `text === ""`) AND text contains NONE of `[[`, `![[`, `#`, `http`, `- [` are skipped; items with meta-actions (where `rawText !== text`) bypass `shouldSkip`
13. Archive tag: items whose text includes `#<archiveTag>` (the tag prefixed with `#`) are skipped via `shouldSkip`
14. Frontmatter offset: when `frontmatterBodyStart > 0`, scanning begins at the line corresponding to that byte offset
15. Position fields use `col` for `DvList` and `ch` for `HeadingCache`
16. `.trim()` is applied at all three points for list items (initial capture, task extraction, post-meta-strip) and at header text extraction
17. `#[wasm_bindgen]` export `scan_markdown(content, file_path, frontmatter_body_start, archive_tag)` returns valid JSON
18. JSON output serializes `parent: undefined` as `null` (JSON has no `undefined`)
19. TypeScript adapter `adaptScanResult` in `adapter.ts` converts JSON to `{ lists: DvList[]; headers: HeadingCache[] }` with `null` parent values converted to `undefined`
20. `NativeParserHandle` and `WasmExports` types are extended with `scan_markdown`
21. Conformance tests compare Rust vs TS output on ALL 8 integration fixture files and produce deep-equal results for both `lists` and `headers`
22. Conformance tests include synthetic cases for: deeply nested items, header resets, tasks with links, meta-action stripping, archive filtering, items with `- [` in text, trailing whitespace on header/list lines, mixed bullet types, frontmatter offset

## Feature Mapping

- **Source feature**: `improve-indexing-performance-for-obsidian-tree-search`
- **Slice item**: `rust-parser-03-list-scanner`
