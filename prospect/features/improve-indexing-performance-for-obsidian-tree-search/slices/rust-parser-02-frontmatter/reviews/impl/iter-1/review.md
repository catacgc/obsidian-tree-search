### Critical (must fix before archiving)
- [ ] **`find_body_start_line` produces incorrect result for CRLF content with non-zero `frontmatter_body_start`** — The function counts `line.len() + 1` per line (treating the separator as 1 char), but for CRLF content the lines have already been stripped of `\r` while the `frontmatter_body_start` was computed on the original content (counting `\r\n` as 2 chars). This means the accumulated char count can never reach `frontmatter_body_start`, causing the function to return `lines.len()` (skip all lines), while the TS implementation falls back to `bodyStartLine = 0` (scan from beginning, which works correctly since frontmatter lines don't match any patterns). For a CRLF file with frontmatter, the Rust scanner produces empty results while the TS scanner produces correct results. — `packages/parser-native/src/list_scanner.rs:468-481`

### Warnings (should address or explicitly defer)
- [ ] **No conformance test exercises CRLF content with non-zero frontmatter body-start** — The test suite has a CRLF test (with `bodyStart=0`) and a frontmatter test (with LF content), but no test combines both. This would catch the `find_body_start_line` bug and should be added. — `packages/parser-native/ts/__tests__/list-scanner.test.ts` (missing test case)
- [ ] **`find_body_start_line` fallback behavior diverges from TS** — When the body start position cannot be matched (e.g., the bug above, or any future edge case), TS falls back to scanning from line 0 (safe — frontmatter lines are harmlessly skipped), while Rust falls back to `lines.len()` (no scanning at all). Even if the CRLF counting is fixed, the fallback should match TS behavior (return 0 instead of `lines.len()`) for robustness. — `packages/parser-native/src/list_scanner.rs:481`
- [ ] **Proposal AC13 text omits `- [` condition** — The proposal at line 61 says "Pure-prose items (no `[[`, `![[`, `#`, or `http`) are skipped" but the implementation correctly includes all 5 conditions (including `- [`). The proposal text is inconsistent with the implementation and spec. — `prospect/features/rust-parser/slices/rust-parser-03-list-scanner/proposal.md:61`

### Suggestions (consider before or after archiving)
- [ ] **Unicode tag characters diverge between TS and Rust** — TS `/#([\w/]+)/g` uses JS `\w` which matches Unicode letters (depending on engine flags), while Rust `is_tag_char` only checks `is_ascii_alphanumeric() || '_' || '/'`. Tags with non-ASCII characters (e.g., `#日本語`) would be extracted by TS but truncated/missed by Rust. Not triggered by any current fixture or test, but could cause divergence for international users. — `packages/parser-native/src/list_scanner.rs:211-214`

### Verified
- [x] **Rust `scan_markdown` function exists with correct signature** — confirmed at `list_scanner.rs:345-350`
- [x] **`#[wasm_bindgen]` export with correct parameters** — confirmed at `lib.rs:24-28`
- [x] **Header detection (levels 1-6) with trimmed text** — confirmed at `list_scanner.rs:379-397` with trim at line 381
- [x] **List item detection (all bullet types: `-`, `*`, `+`, `\d+.`)** — confirmed at `list_scanner.rs:71-117`
- [x] **Task detection (`[ ]`, `[x]`, `[X]`) with correct text stripping** — confirmed at `list_scanner.rs:152-179, 408-414`
- [x] **rawText assignment after task strip, before meta strip** — confirmed at `list_scanner.rs:417`
- [x] **Meta-action stripping from text, preserved in rawText** — confirmed at `list_scanner.rs:420`
- [x] **Meta-mdtree stripping** — confirmed at `list_scanner.rs:421`
- [x] **shouldSkip with all 5 conditions including `- [`** — confirmed at `list_scanner.rs:331-341`
- [x] **Indent stack parent wiring with correct popping logic** — confirmed at `list_scanner.rs:433-442`
- [x] **Indent stack reset on header** — confirmed at `list_scanner.rs:395`
- [x] **Section subpath tracking** — confirmed at `list_scanner.rs:365, 392`
- [x] **Post-pass children wiring** — confirmed at `list_scanner.rs:462-529`
- [x] **Archive tag filtering with `#` prefix** — confirmed at `list_scanner.rs:370, 428`
- [x] **LF/CRLF splitting** — confirmed at `list_scanner.rs:351-357`
- [x] **All three trim points** — confirmed at lines 405, 410, 422
- [x] **Inline tag extraction** — confirmed at `list_scanner.rs:181-208`
- [x] **Position fields with correct col/ch naming** — `ListPos` uses `col`, `HeadingPos` uses `ch` — confirmed at lines 39-43, 63-67
- [x] **`adaptScanResult` with null→undefined conversion** — confirmed at `adapter.ts:49-64`
- [x] **NativeParserHandle and WasmExports types updated** — confirmed at `index.ts:7` and `loader.ts:4`
- [x] **41 Rust unit tests covering all behaviors** — confirmed at `list_scanner.rs:531-865`
- [x] **24 TypeScript conformance tests (8 fixture + 16 synthetic)** — confirmed at `list-scanner.test.ts:43-182`
- [x] **No TODOs/FIXMEs introduced** — confirmed via grep
- [x] **Correct serde attributes (`rename_all = "camelCase"` on DvListItem)** — confirmed at lines 12-13