# Tasks: rust-parser-03-list-scanner

## Task 1: Add `list_scanner.rs` module with core data structures

Create `packages/parser-native/src/list_scanner.rs` with:

- Serde-serializable output structs:
  - `ScanResult` with fields `lists: Vec<DvListItem>` and `headers: Vec<HeadingCacheItem>`
  - `DvListItem` with fields:
    - `link: LinkRef` (struct with `path: String`)
    - `text: String`
    - `raw_text: String` (serialized as `rawText`)
    - `line: usize`
    - `position: ListPosition` (struct with `start: { line: usize, col: usize }`, `end: { line: usize, col: usize }`)
    - `parent: Option<usize>` (serialized as null when None)
    - `children: Vec<DvListItem>` (populated in post-pass; serialized recursively)
    - `tags: Vec<String>`
    - `section: Section` (struct with `subpath: String`)
    - `task: bool`
    - `completed: bool`
  - `HeadingCacheItem` with fields:
    - `heading: String`
    - `level: usize`
    - `position: HeadingPosition` (struct with `start: { line: usize, ch: usize }`, `end: { line: usize, ch: usize }`)
- All structs derive `Serialize` and use `#[serde(rename_all = "camelCase")]`
- Declare `mod list_scanner;` in `lib.rs`

## Task 2: Implement the `scan_markdown` function body

In `list_scanner.rs`, implement `pub fn scan_markdown(content: &str, file_path: &str, frontmatter_body_start: usize, archive_tag: &str) -> ScanResult`:

1. **Line splitting**: Split content on `\r?\n` (handle both LF and CRLF)
2. **Body-start line calculation**: Iterate lines, accumulating character count (line.len() + 1 for \n), find the first line where accumulated chars >= `frontmatter_body_start` — this is `body_start_line`
3. **Main loop** from `body_start_line` to `lines.len()`:
   - Skip empty/whitespace-only lines
   - **Header detection**: Match `^(#{1,6})\s+(.*)` → push to `headers`, update `current_section_subpath` to `#heading_text`, pop header stack for level tracking, reset indent stack
   - **List item detection**: Match `^(\s*)(?:[-*+]|\d+\.)\s+(.*)` → extract indent and text
   - **Task detection**: On the extracted text, match `^\[([ xX])\]\s+(.*)` → set task/completed, strip prefix
   - **rawText assignment**: `rawText = text` (after task stripping, before meta stripping)
   - **Meta-action stripping**: Remove `\(meta-action-[\w-]+::[^)]*\)` from text
   - **Meta-mdtree stripping**: Remove `\(meta-mdtree::\s*\w+\)` from text
   - **Trim text** after stripping
   - **Inline tag extraction**: Find all `#([\w/]+)` matches in text → push `#tag` to tags vec
   - **shouldSkip logic**:
     - If `rawText == text` (no meta stripped) OR `text == ""`: apply shouldSkip
     - `shouldSkip`: returns true if text contains `#archiveTag`, or if text has no `[[`, `![[`, `#`, or `http`
   - **Indent stack management**: Pop entries with indent >= current indent; parent = top of stack's line_num (or None); push current
   - Push `DvListItem` to flat `lists` vec (with `children: vec![]` initially)
4. **Post-pass**: Build a `HashMap<usize, usize>` mapping line → index. For each item with a `parent` line number, push a clone/reference into the parent's `children` vec. Use recursive structure matching TS output (children contain full DvListItem objects).

## Task 3: Add `#[wasm_bindgen]` export in `lib.rs`

Add to `packages/parser-native/src/lib.rs`:

```rust
#[wasm_bindgen]
pub fn scan_markdown(content: &str, file_path: &str, frontmatter_body_start: usize, archive_tag: &str) -> String {
    let result = list_scanner::scan_markdown(content, file_path, frontmatter_body_start, archive_tag);
    serde_json::to_string(&result).unwrap_or_else(|_| r#"{"lists":[],"headers":[]}"#.to_string())
}
```

Update the `NativeParserHandle` type in `packages/parser-native/ts/index.ts` to include:
```typescript
scan_markdown: (content: string, file_path: string, frontmatter_body_start: number, archive_tag: string) => string
```

## Task 4: Write Rust unit tests

Add `#[cfg(test)] mod tests` block in `list_scanner.rs` with tests for:

- `basic_header_detection` — 3 headers with correct levels and headings
- `header_line_numbers` — correct `position.start.line` for headers
- `plain_text_not_header` — non-header lines produce no headers
- `list_item_dash_prefix` — items with `-` detected
- `list_item_star_plus_prefix` — items with `*` and `+` detected
- `numbered_list_items` — items with `1.` detected
- `pure_prose_skipped` — items without links/tags/http produce empty lists
- `keeps_obsidian_links` — items with `[[...]]` are kept
- `keeps_http_urls` — items with `http` are kept
- `keeps_tagged_items` — items with `#tag` are kept, tags extracted correctly
- `multiple_tags_extracted` — multiple inline tags all captured
- `task_uncompleted` — `[ ]` sets task=true, completed=false
- `task_completed_lowercase` — `[x]` sets completed=true
- `task_completed_uppercase` — `[X]` sets completed=true
- `task_prefix_stripped_from_text` — text does not contain `[ ] ` prefix
- `pure_prose_task_skipped` — task with no links/tags is skipped
- `parent_wiring_single_level` — child's parent matches parent's line
- `parent_wiring_deep` — 3-level nesting, each child references its direct parent
- `sibling_items_no_parent` — top-level siblings have parent=None
- `dedent_resets_parent` — after nested item, de-dented item has no parent
- `children_post_pass` — parent's children vec contains child items
- `section_subpath_from_header` — items under header get `#HeaderText`
- `section_empty_before_header` — items before any header get `""`
- `section_updates_on_new_header` — new header changes subpath
- `indent_stack_resets_on_header` — item after header has no parent from pre-header items
- `archive_tag_skips_item` — item containing archive tag is skipped
- `frontmatter_body_start_offset` — lines before offset are skipped
- `meta_action_stripped_from_text` — text has meta-action removed
- `meta_action_preserved_in_raw_text` — rawText retains meta-action syntax
- `meta_action_only_skipped` — item with only meta-action (empty text after strip) is skipped
- `plain_text_with_meta_action_kept` — item with prose + meta-action is kept (rawText≠text)
- `meta_mdtree_stripped` — meta-mdtree removed from text, preserved in rawText
- `crlf_line_endings` — same results as LF
- `link_path_set_from_argument` — `link.path` equals the `file_path` parameter
- `position_fields_correct` — start.col = indent, end.col = line.length

## Task 5: Implement TypeScript adapter function `adaptScanResult`

In `packages/parser-native/ts/adapter.ts`, add and export:

```typescript
import type { DvList, HeadingCache } from "@mdtree/core"

export function adaptScanResult(json: string): { lists: DvList[], headers: HeadingCache[] } {
  // Parse JSON from Rust scan_markdown output
  // Map the flat JSON structure to typed DvList[] and HeadingCache[]
  // Ensure parent is `undefined` (not null) when absent — TS semantics
  // The Rust output already has children wired as nested objects (matching DvList[])
  // Return typed result
}
```

Key implementation details:
- `parent: null` in JSON must become `parent: undefined` in the TS object (or simply delete the key)
- Children are already nested `DvListItem` objects in the JSON (Rust post-pass produces them)
- `HeadingCache` position uses `ch` not `col` — ensure field mapping is correct

## Task 6: Write TypeScript conformance tests

Create `packages/parser-native/ts/__tests__/list-scanner.test.ts`:

- Load WASM module in `beforeAll` (same pattern as `frontmatter.test.ts`)
- For each `.md` file in `packages/core/src/__tests__/integration/fixtures/**/*.md`:
  - Read file content
  - Parse frontmatter with TS `parseFrontmatter` to get `bodyStart`
  - Call Rust `scan_markdown(content, filePath, bodyStart, "archive")` → adapt with `adaptScanResult`
  - Call TS `scanMarkdown(content, filePath, bodyStart, "archive")`
  - Assert deep equality of `lists` and `headers`
- Add synthetic conformance tests:
  - Meta-action stripping
  - Nested items with parent wiring
  - Task detection (all variants)
  - CRLF content
  - Multiple headers with items between them
  - File with frontmatter (non-zero bodyStart)
