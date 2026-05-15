## Summary

- Tasks completed:
  1. **Task 1**: Created `list_scanner.rs` with serde data structures (`ScanResult`, `DvListItem`, `HeadingCacheItem`, position types) and declared `mod list_scanner` in `lib.rs`
  2. **Task 2**: Implemented `scan_markdown` function body with line splitting, header/list detection, task detection, indent-stack parent wiring, meta-action/meta-mdtree stripping, shouldSkip with all 5 conditions (including `- [`), all 3 trim points, header trim, archive tag filtering, and children post-pass
  3. **Task 3**: Added `#[wasm_bindgen]` export in `lib.rs` and updated `NativeParserHandle`, `WasmExports`, and loader types
  4. **Task 4**: Wrote 41 Rust unit tests covering all scanner behaviors (headers, bullets, tasks, shouldSkip, nesting, sections, meta-stripping, archive, offset, trim, CRLF, positions)
  5. **Task 5**: Implemented `adaptScanResult` TypeScript adapter function with `null` → `undefined` conversion for parent fields
  6. **Task 6**: Wrote 24 TypeScript conformance tests (8 fixture files + 16 synthetic cases including trailing whitespace, `- [` patterns, CRLF, deep nesting)

- Tests: **pass** — 58 Rust tests + 191 TypeScript tests (all packages, 0 failures)

- Commits: `feat(parser-native): implement list scanner in Rust (slice 03)`