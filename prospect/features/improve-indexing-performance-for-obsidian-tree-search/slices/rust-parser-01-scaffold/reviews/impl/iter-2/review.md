### Critical (must fix before archiving)
(none)

### Warnings (should address or explicitly defer)
(none)

### Suggestions (consider before or after archiving)
(none)

### Verified
- [x] **Off-by-one in `find_closing_delimiter` LF branch fixed** — guard now correctly `i + 4 <= len` at `packages/parser-native/src/frontmatter.rs:75`, regression test at line 255-262
- [x] **Off-by-one in `find_closing_delimiter` CRLF branch fixed** — guard now correctly `i + 5 <= len` at `packages/parser-native/src/frontmatter.rs:90`, regression test at line 265-272
- [x] **`console_error_panic_hook` installed** — `#[wasm_bindgen(start)]` init function at `packages/parser-native/src/lib.rs:7-9`, dependency at `Cargo.toml:14`
- [x] **"aliases as string" conformance test added** — `packages/parser-native/ts/__tests__/frontmatter.test.ts:108-114` and Rust unit test at `frontmatter.rs:275-279`
- [x] **"multiline values" conformance test added** — `packages/parser-native/ts/__tests__/frontmatter.test.ts:116-126` (strip scalar) and Rust unit tests at `frontmatter.rs:283-306` (both clip and strip variants)
- [x] No TODO/FIXME/debug markers in implementation — confirmed via grep
- [x] All previously verified items remain intact (ParserProvider interface, TsParserProvider delegation, exports, adapter, loader)