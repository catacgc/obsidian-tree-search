# Tasks: rust-parser-03-list-scanner

## Task 1 — Add `regex` dependency and create `list_scanner.rs` with serde output types

**Modify `packages/parser-native/Cargo.toml`:**

- Add `regex = "1"` under `[dependencies]`. This crate is needed for the six regex patterns used in list scanning. (Note: `regex-lite` would save binary size but lacks some features; standard `regex` is acceptable given the WASM size budget still has room.)

**Create `packages/parser-native/src/list_scanner.rs`:**

- Define serde-serializable output structs:
  ```rust
  use serde::Serialize;
  use regex::Regex;
  use std::sync::OnceLock;

  #[derive(Serialize, Clone)]
  #[serde(rename_all = "camelCase")]
  pub struct ScanResult {
      pub lists: Vec<DvListItem>,
      pub headers: Vec<HeadingCacheItem>,
  }

  #[derive(Serialize, Clone)]
  #[serde(rename_all = "camelCase")]
  pub struct DvListItem {
      pub link: LinkRef,
      pub text: String,
      pub raw_text: String,
      pub line: usize,
      pub position: DvListPosition,
      pub parent: Option<usize>,    // serializes as null when None
      pub children: Vec<DvListItem>,
      pub tags: Vec<String>,
      pub section: Section,
      pub task: bool,
      pub completed: bool,
  }

  #[derive(Serialize, Clone)]
  pub struct LinkRef {
      pub path: String,
  }

  #[derive(Serialize, Clone)]
  pub struct DvListPosition {
      pub start: DvListPos,
      pub end: DvListPos,
  }

  #[derive(Serialize, Clone)]
  pub struct DvListPos {
      pub line: usize,
      pub col: usize,
  }

  #[derive(Serialize, Clone)]
  pub struct Section {
      pub subpath: String,
  }

  #[derive(Serialize, Clone)]
  pub struct HeadingCacheItem {
      pub heading: String,
      pub level: usize,
      pub position: HeadingPosition,
  }

  #[derive(Serialize, Clone)]
  pub struct HeadingPosition {
      pub start: HeadingPos,
      pub end: HeadingPos,
  }

  #[derive(Serialize, Clone)]
  pub struct HeadingPos {
      pub line: usize,
      pub ch: usize,
  }
  ```
- Note the field name differences: `DvListPos` uses `col`, `HeadingPos` uses `ch` — matching the TypeScript types in `packages/core/src/graph/types.ts`.
- Use `#[serde(rename_all = "camelCase")]` on `DvListItem` so that `raw_text` serializes as `rawText`.

**Modify `packages/parser-native/src/lib.rs`:**

- Add `mod list_scanner;` declaration.

**Verification:** `cargo check` passes.

---

## Task 2 — Implement `scan_markdown` function body

Implement the public function in `list_scanner.rs`:

```rust
pub fn scan_markdown(content: &str, file_path: &str, frontmatter_body_start: usize, archive_tag: &str) -> ScanResult
```

**Step 1: Regex initialization (compile once via `OnceLock` or `lazy_static`).**

Use `std::sync::OnceLock` (stable since Rust 1.70) to lazily compile:
- `LIST_ITEM_RE`: `^(\s*)(?:[-*+]|\d+\.)\s+(.*)`
- `HEADER_RE`: `^(#{1,6})\s+(.*)`
- `TASK_RE`: `^\[([ xX])\]\s+(.*)`
- `INLINE_TAG_RE`: `#([\w/]+)` (used with `find_iter`/`captures_iter`)
- `META_ACTION_RE`: `\(meta-action-[\w-]+::[^)]*\)` (used with `replace_all`)
- `META_MDTREE_RE`: `\(meta-mdtree::\s*\w+\)` (used with `replace_all`)

**Step 2: Line splitting and body-start-line calculation.**

- Split `content` by `\n`. Each resulting element may have a trailing `\r` from CRLF — do NOT strip `\r` from lines (the regex patterns are anchored at `^` and match on the logical content; trailing `\r` should be handled naturally since the regex `.*` captures the `\r` as part of text, matching the TS behavior where `split(/\r?\n/)` removes it). Actually, more precisely: the TS code uses `content.split(/\r?\n/)` which splits on `\r\n` OR `\n`, removing the line ending entirely. The Rust equivalent is: split on `\n`, then strip trailing `\r` from each line.
- Calculate `body_start_line`: iterate lines accumulating byte counts (each line length + 1 for newline). The first line index `i` where accumulated bytes >= `frontmatter_body_start` is `body_start_line`. This mirrors the TS logic at lines 42-50 of `list-scanner.ts`.

**Step 3: Main scan loop (iterate from `body_start_line` to end of lines).**

For each line (by index `line_num`):

1. Skip empty lines after `.trim()` check (matches TS line 68: `if (!line.trim()) continue`).

2. **Header detection:** Match `HEADER_RE` against the line.
   - If matched:
     - `level` = length of capture group 1.
     - `heading` = capture group 2, **trimmed** (`.trim()`) — addresses reviewer finding about header text trim.
     - Push `HeadingCacheItem { heading, level, position: { start: { line: line_num, ch: 0 }, end: { line: line_num, ch: line.len() } } }`.
     - Update `current_section_subpath = format!("#{}", heading)`.
     - Clear indent stack: `indent_stack.clear()`.
     - `continue`.

3. **List item detection:** Match `LIST_ITEM_RE` against the line.
   - If no match: `continue`.
   - `indent` = byte length of capture group 1.
   - `text` = capture group 2, **trimmed** (`.trim().to_string()`) — FIRST trim point (addresses reviewer suggestion).

4. **Task detection:** Match `TASK_RE` against `text`.
   - If matched: `is_task = true`; `completed = (cap[1].to_lowercase() == "x")`; `text = cap[2].trim().to_string()` — SECOND trim point.
   - Else: `is_task = false`; `completed = false`.

5. **Meta stripping and rawText preservation:**
   - `raw_text = text.clone()`
   - `text = META_ACTION_RE.replace_all(&text, "").to_string()`
   - `text = META_MDTREE_RE.replace_all(&text, "").to_string()`
   - `text = text.trim().to_string()` — THIRD trim point.

6. **Inline tag extraction:** Use `INLINE_TAG_RE.captures_iter(&text)` to collect tags.
   - For each match, push `format!("#{}", &cap[1])` to a `tags: Vec<String>`.

7. **shouldSkip evaluation (ALL FIVE conditions — addresses accepted reviewer finding):**
   - Construct the full archive tag: `let archive_tag_full = format!("#{}", archive_tag)`
   - Condition: `(raw_text == text || text.is_empty()) && should_skip(&text, &archive_tag_full)`
   - If true: `continue` (skip this item).
   - `should_skip` implementation:
     ```rust
     fn should_skip(text: &str, archive_tag: &str) -> bool {
         if text.contains(archive_tag) { return true; }
         !text.contains("[[")
             && !text.contains("![[")
             && !text.contains("#")
             && !text.contains("http")
             && !text.contains("- [")
     }
     ```

8. **Parent wiring (indent stack management):**
   - Pop all entries from `indent_stack` where `entry.indent >= indent`.
   - `parent_line_num = indent_stack.last().map(|e| e.line_num)`.
   - Push `StackEntry { indent, line_num }` onto stack.

9. **Construct `DvListItem` and push to flat list.**

**Step 4: Post-pass for `.children` wiring.**

- Build a `HashMap<usize, usize>` mapping `line_number → index` in the flat `lists` vec.
- Iterate the flat list: for items with `parent = Some(p)`, clone the item (without children recursion — just the direct item) and push into `lists[parent_index].children`.
- Important subtlety: The TS code pushes the *same reference* into the parent's children array. In serialized JSON, this means children appear both as top-level items in the flat `lists` array AND nested within their parent's `children`. The Rust implementation must replicate this by cloning items into children after the main loop. The cloned children should have their own `children` populated (i.e., build children recursively or do a bottom-up pass).

**Verification:** `cargo check` passes; function compiles without errors.

---

## Task 3 — Add `#[wasm_bindgen]` export in `lib.rs` and update TypeScript types

**Modify `packages/parser-native/src/lib.rs`:**

- Add the exported function:
  ```rust
  #[wasm_bindgen]
  pub fn scan_markdown(content: &str, file_path: &str, frontmatter_body_start: usize, archive_tag: &str) -> String {
      let result = list_scanner::scan_markdown(content, file_path, frontmatter_body_start, archive_tag);
      serde_json::to_string(&result).unwrap_or_else(|_| r#"{"lists":[],"headers":[]}"#.to_string())
  }
  ```

**Modify `packages/parser-native/ts/loader.ts`:**

- Add `scan_markdown` to `WasmExports` type:
  ```typescript
  export type WasmExports = {
    ping: () => string
    parse_frontmatter: (content: string) => string
    scan_markdown: (content: string, filePath: string, frontmatterBodyStart: number, archiveTag: string) => string
  }
  ```
- Add `scan_markdown: glue.scan_markdown` to the returned object in the `loadWasm` function.

**Modify `packages/parser-native/ts/index.ts`:**

- Update `NativeParserHandle` type to include:
  ```typescript
  scan_markdown: (content: string, filePath: string, frontmatterBodyStart: number, archiveTag: string) => string
  ```

**Verification:** `wasm-pack build --target web --out-dir pkg` succeeds; TypeScript type-checks (`bunx tsc --noEmit`).

---

## Task 4 — Write Rust unit tests (>=35 tests)

Add `#[cfg(test)] mod tests` block at the bottom of `list_scanner.rs`:

**Header detection (6 tests):**
1. `test_header_h1` — `"# Alpha"` → headers[0]: level=1, heading="Alpha"
2. `test_header_h6` — `"###### Deep"` → level=6, heading="Deep"
3. `test_header_position` — verifies `position.start.line` and `position.end.ch` match line length
4. `test_header_trimmed` — `"# Hello   "` → heading="Hello" (trailing whitespace trimmed)
5. `test_no_header_without_space` — `"#NotAHeader"` → no header produced (requires space after `#`)
6. `test_multiple_headers` — `"# A\n## B\n### C"` → 3 headers with correct levels and line numbers

**List item detection (5 tests):**
7. `test_dash_bullet` — `"- [[Note]]"` → 1 list item
8. `test_star_bullet` — `"* [[Note]]"` → 1 list item
9. `test_plus_bullet` — `"+ [[Note]]"` → 1 list item
10. `test_numbered_item` — `"1. [[Note]]"` → 1 list item
11. `test_no_match_plain_line` — `"just text"` → 0 list items

**Task detection (4 tests):**
12. `test_task_open` — `"- [ ] [[X]]"` → task=true, completed=false
13. `test_task_completed_lower` — `"- [x] [[X]]"` → completed=true
14. `test_task_completed_upper` — `"- [X] [[X]]"` → completed=true
15. `test_task_prefix_stripped` — `"- [ ] do [[thing]]"` → text="do [[thing]]"

**shouldSkip logic (6 tests):**
16. `test_skip_pure_prose` — `"- just text"` → empty lists
17. `test_keep_obsidian_link` — `"- [[Note]]"` → 1 item
18. `test_keep_tag` — `"- item #tag"` → 1 item
19. `test_keep_http` — `"- http://x.com"` → 1 item
20. `test_keep_task_reference` — `"- see - [x] done"` → 1 item (the `"- ["` check keeps it)
21. `test_skip_prose_task` — `"- [ ] plain text"` → 0 items (task marker stripped, remaining is prose)

**Indent stack and parent wiring (5 tests):**
22. `test_nested_parent` — `"- [[A]]\n  - [[B]]"` → B.parent = Some(0)
23. `test_sibling_no_parent` — `"- [[A]]\n- [[B]]"` → both parent=None
24. `test_deep_nesting` — 3 levels → correct parent chain
25. `test_dedent_resets` — `"- [[A]]\n  - [[B]]\n- [[C]]"` → C.parent=None
26. `test_children_wired` — parent's children vec contains the child items

**Section tracking (3 tests):**
27. `test_section_from_header` — items after `"# Section\n- [[A]]"` get subpath="#Section"
28. `test_section_before_header` — `"- [[A]]"` → subpath=""
29. `test_section_updates` — `"# First\n- [[A]]\n# Second\n- [[B]]"` → A="#First", B="#Second"

**Meta stripping (4 tests):**
30. `test_meta_action_stripped` — meta-action removed from text, rawText preserved
31. `test_meta_mdtree_stripped` — meta-mdtree removed from text, rawText preserved
32. `test_rawtext_equals_text_no_meta` — no annotations → rawText == text
33. `test_meta_only_skipped` — `"- (meta-action-name::X)(meta-action-url::Y)"` → text is empty after strip → skipped (text.is_empty() triggers shouldSkip)

**Archive tag (2 tests):**
34. `test_archive_tag_skips` — `"- [[Note]] #archive"` with archive_tag="archive" → skipped
35. `test_different_tag_kept` — `"- [[Note]] #todo"` with archive_tag="archive" → kept

**Frontmatter offset (2 tests):**
36. `test_frontmatter_offset` — bodyStart=18, items after offset detected
37. `test_zero_offset` — bodyStart=0, scans from line 0

**Trim and position (2 tests):**
38. `test_list_item_trimmed` — `"- [[Note]]   "` → text="[[Note]]" (trimmed)
39. `test_position_col` — 4-space-indented item → position.start.col=4

**Verification:** `cargo test` passes all tests (>=39 tests total).

---

## Task 5 — Implement `adaptScanResult` TypeScript adapter function

**Modify `packages/parser-native/ts/adapter.ts`:**

- Import `DvList` and `HeadingCache` types from `@mdtree/core`.
- Export function `adaptScanResult(json: string): { lists: DvList[]; headers: HeadingCache[] }`:
  ```typescript
  export function adaptScanResult(json: string): { lists: DvList[]; headers: HeadingCache[] } {
    const parsed = JSON.parse(json) as {
      lists: Array<RawDvListItem>
      headers: HeadingCache[]
    }

    return {
      lists: parsed.lists.map(adaptItem),
      headers: parsed.headers,
    }
  }
  ```
- Define internal type `RawDvListItem` matching the JSON shape (with `parent: number | null`).
- Implement `adaptItem(item: RawDvListItem): DvList` that:
  - Converts `parent: null` → `parent: undefined`
  - Recursively adapts `children` (they also have `parent` fields)
  - Passes through all other fields directly
- Key conversion: JSON cannot represent `undefined`, so the Rust serializer emits `null` for `Option<usize>::None`. The adapter must convert this to `undefined` for TypeScript deep equality with the TS `scanMarkdown` output.

**Verification:** TypeScript type-checks without errors (`bunx tsc --noEmit`).

---

## Task 6 — Write TypeScript conformance tests

**Create `packages/parser-native/ts/__tests__/list-scanner.test.ts`:**

- Import `scanMarkdown` and `parseFrontmatter` from `@mdtree/core`.
- Import `adaptScanResult` from `../adapter.ts`.
- Import `loadNativeParser` from `../index.ts`.
- Load WASM in `beforeAll` from `../../pkg/parser_native_bg.wasm`.
- Helper function:
  ```typescript
  function scanWithRust(content: string, filePath: string, bodyStart: number, archiveTag: string) {
    const json = handle.scan_markdown(content, filePath, bodyStart, archiveTag)
    return adaptScanResult(json)
  }
  ```

**Fixture conformance tests (8 tests):**

For each fixture file, read the content, compute `bodyStart` via `parseFrontmatter`, and compare:
1. `aliases/meeting notes.md`
2. `archive/notes.md`
3. `basic-search/meeting notes.md`
4. `deep-nesting/architecture.md`
5. `multi-page/child note.md`
6. `multi-page/index.md`
7. `negation/items.md`
8. `page-header-link/projects.md`

Each test asserts:
- `rustResult.lists` deep-equals `tsResult.lists`
- `rustResult.headers` deep-equals `tsResult.headers`

**Synthetic conformance tests (>=12 tests):**

9. Deeply nested (3+ levels) — verify parent chain and children
10. Header resets indent stack — post-header item has no parent
11. Task with obsidian link — task=true, link in text
12. Meta-action stripped — text vs rawText
13. Meta-mdtree stripped — text vs rawText
14. Archive tag filtering — item with `#archive` excluded
15. Item with `- [` in text is NOT skipped — `"- see also - [x] finished #tag"` (kept because of `#` in text)
16. Item with `- [` in text but no other keep-patterns — `"- check the list - [ ] empty"` (kept because `- [` itself is a keep-pattern)
17. Trailing whitespace on header — `"# Hello   \n- [[A]]"` → heading trimmed, subpath is `#Hello`
18. Trailing whitespace on list item — `"- [[Note]]   "` → text trimmed
19. Mixed bullet types in one file — `-`, `*`, `+`, `1.` all detected
20. Frontmatter offset — scanning begins after frontmatter
21. File with only headers (no list items) — lists empty, headers populated
22. Completed task with meta-action — task detected, meta stripped, rawText preserved

**Verification:** `bun test packages/parser-native/ts/__tests__/list-scanner.test.ts` passes (requires prior `wasm-pack build`).
