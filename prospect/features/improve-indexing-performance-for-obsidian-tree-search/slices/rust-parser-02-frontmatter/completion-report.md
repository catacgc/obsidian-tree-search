## Completion Checklist

### Tasks
- [x] Task 1 — Add regex dep / create `list_scanner.rs` with serde types, declare module — PASS: Types defined (`ScanResult`, `DvListItem`, `HeadingCacheItem`, etc.) with correct field names (`col` for DvList, `ch` for HeadingCache), `mod list_scanner` in `lib.rs`. Note: `regex` crate not added; hand-written parsers used instead (equivalent functionality, smaller WASM binary).
- [x] Task 2 — Implement `scan_markdown` function body — PASS: Full implementation with line splitting, header/list detection, task detection, all 5 `shouldSkip` conditions (including `- [`), all 3 trim points, header trim, indent stack, meta stripping, archive filtering, children post-pass, CRLF handling with correct `find_body_start_line`.
- [x] Task 3 — Add `#[wasm_bindgen]` export and update TS types — PASS: `scan_markdown` exported at `lib.rs:24-28`, `WasmExports` in `loader.ts:4`, `NativeParserHandle` in `index.ts:7`.
- [x] Task 4 — Write ≥35 Rust unit tests — PASS: 41 unit tests (within the 61 total Rust tests including frontmatter tests) covering headers, bullets, tasks, shouldSkip, nesting, sections, meta-stripping, archive, offset, trim, CRLF, positions.
- [x] Task 5 — Implement `adaptScanResult` TypeScript adapter — PASS: `adapter.ts:24-30` exports `adaptScanResult` with `null` → `undefined` conversion for parent fields via recursive `adaptListItem`.
- [x] Task 6 — Write TypeScript conformance tests — PASS: 26 tests (fixture files dynamically discovered + 18 synthetic cases) covering all specified patterns.

### Tests
- [x] Full suite: 61 Rust tests passed, 193 TypeScript tests passed — PASS

### Code State
- [x] No uncommitted changes to slice code — PASS (3 unrelated pre-existing changes: deleted `.claude/settings.local.json`, modified `.gitignore`, deleted `CLAUDE.md`)
- [x] No TODOs/FIXMEs introduced — PASS

### Acceptance Criteria
- [x] AC1: `list_scanner.rs` exists with public `scan_markdown` function — PASS: line 345
- [x] AC2: `cargo test` passes ≥35 tests — PASS: 41 list scanner tests
- [x] AC3: Header detection with trimmed heading and correct position fields — PASS: lines 381-392
- [x] AC4: All bullet types (`-`, `*`, `+`, `N.`) recognized — PASS: `is_list_item` at lines 71-117
- [x] AC5: Task detection — PASS: `is_task` at lines 152-179
- [x] AC6: Indent stack parent wiring with reset on header — PASS: lines 434-444, 397
- [x] AC7: Children post-pass — PASS: `wire_children` at lines 490-533
- [x] AC8: Section subpath tracking — PASS: lines 367, 394
- [x] AC9: Inline tag extraction — PASS: `extract_inline_tags` at lines 181-208
- [x] AC10: Meta-action stripping from text, preserved in rawText — PASS: lines 419-422
- [x] AC11: Meta-mdtree stripping — PASS: line 423
- [x] AC12: `shouldSkip` with all 5 conditions including `- [` — PASS: lines 331-341
- [x] AC13: Archive tag filtering — PASS: lines 372, 430
- [x] AC14: Frontmatter offset handling — PASS: `find_body_start_line` at lines 470-486
- [x] AC15: Position fields use `col` for DvList, `ch` for HeadingCache — PASS: types at lines 40-43, 63-67
- [x] AC16: `.trim()` at all three list-item points and header — PASS: lines 407, 412, 424, 382
- [x] AC17: `#[wasm_bindgen]` export returns valid JSON — PASS: `lib.rs:24-28`
- [x] AC18: JSON serializes `parent: undefined` as `null` — PASS: `Option<usize>` serializes as null
- [x] AC19: `adaptScanResult` converts null→undefined — PASS: `adapter.ts:56`
- [x] AC20: `NativeParserHandle` and `WasmExports` extended — PASS: `index.ts:7`, `loader.ts:4`
- [x] AC21: Conformance tests on fixture files — PASS: dynamic discovery of all `.md` files in fixtures
- [x] AC22: Synthetic cases cover all specified scenarios — PASS: 18 synthetic tests including `- [`, trailing whitespace, CRLF+bodyStart

## Verdict
READY FOR ARCHIVE