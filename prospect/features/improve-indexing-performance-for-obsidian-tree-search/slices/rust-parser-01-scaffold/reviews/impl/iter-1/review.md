#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontmatterResult {
    pub frontmatter: serde_json::Value,
    pub body_start: usize,
}
```

With `#[serde(rename_all = "camelCase")]`, `body_start` becomes `bodyStart` in JSON output. ✓

One last check — the `NativeParserHandle` type in `ts/index.ts` includes both `ping` and `parse_frontmatter`. As future slices add more WASM exports (like `batch_parse_chunk`, `parse_tokens`), this type will need updating. But that's expected — this is the scaffold/frontmatter slice and only these exports exist now. ✓

---

### Critical (must fix before archiving)
- [ ] **Off-by-one in `find_closing_delimiter` line 75: guard `i + 3 <= len` should be `i + 4 <= len`** — When a `\n` byte is found at position `i = len - 3` (e.g., the text after the opening `---\n` ends with `\n--`), the slice `bytes[i+1..i+4]` accesses out-of-bounds memory causing a WASM panic (`RuntimeError: unreachable`). This can be triggered by any markdown file with a malformed/incomplete closing delimiter. Fix: change `i + 3 <= len` to `i + 4 <= len`. — `packages/parser-native/src/frontmatter.rs:75`
- [ ] **Off-by-one in `find_closing_delimiter` line 90: guard `i + 4 <= len` should be `i + 5 <= len`** — Same issue for the `\r\n` branch: when `\r` is found at position `i = len - 4`, the slice `bytes[i+2..i+5]` accesses out-of-bounds, causing a WASM panic. Fix: change `i + 4 <= len` to `i + 5 <= len`. — `packages/parser-native/src/frontmatter.rs:90`

### Warnings (should address or explicitly defer)
- [ ] **No `console_error_panic_hook` or equivalent panic handler in WASM** — Any Rust panic (including from the off-by-one above or from unexpected `serde_yaml`/`serde_json` issues) will produce an opaque `RuntimeError: unreachable` in JavaScript with no useful error message. Adding `console_error_panic_hook` or `std::panic::catch_unwind` would improve debuggability and prevent silent corruption of WASM state. — `packages/parser-native/src/lib.rs` (missing setup)
- [ ] **Conformance tests missing "aliases as string" and "multiline values" cases** — Acceptance criterion #11 explicitly requires testing "aliases as string" and "multiline values", but neither is covered in the conformance test suite. The fixture files only test aliases as arrays and the synthetic cases don't include these variants. — `packages/parser-native/ts/__tests__/frontmatter.test.ts` (missing test cases per spec criterion 11)

### Suggestions (consider before or after archiving)
- [ ] **Spec scenario "Empty frontmatter block" uses incorrect input/output** — The spec states `"---\n---\nbody"` → bodyStart=7, but the TS regex `^---\r?\n([\s\S]*?)\r?\n---` does NOT match this input (no `\n` before closing `---`). Both parsers correctly return bodyStart=0. The Rust test correctly uses `"---\n\n---\nbody"` instead. Consider updating the spec scenario to match reality. — `prospect/features/.../slices/rust-parser-02-frontmatter/spec.md:34-36`
- [ ] **Loader test for invalid bytes doesn't test `loadNativeParser` directly** — The spec scenario says `loadNativeParser(invalidBytes)` MUST reject, but the test (line 27-31) calls `WebAssembly.instantiate` directly, bypassing the actual `loadNativeParser` function. The test comment explains this is due to wasm-pack glue caching state, which is reasonable, but it doesn't strictly verify the error propagation path through `loadNativeParser`. — `packages/parser-native/ts/__tests__/loader.test.ts:24-31`
- [ ] **Duplicate type definitions: `WasmExports` and `NativeParserHandle` are identical** — Both `ts/loader.ts:1-4` and `ts/index.ts:4-7` define the same shape with different names. Consider having `NativeParserHandle` simply alias or extend `WasmExports` to avoid divergence as new WASM exports are added in later slices. — `packages/parser-native/ts/index.ts:4-7` vs `packages/parser-native/ts/loader.ts:1-4`

### Verified
- [x] `packages/parser-native/src/frontmatter.rs` exists with public `parse_frontmatter` function — confirmed at `frontmatter.rs:18`
- [x] `#[wasm_bindgen]` export of `parse_frontmatter` in `lib.rs` returns valid JSON — confirmed at `lib.rs:11-14`
- [x] `serde(rename_all = "camelCase")` produces `bodyStart` in JSON output — confirmed at `frontmatter.rs:5`
- [x] Full YAML parsing via `serde_yaml` handles strings, numbers, booleans, null, arrays, nested objects — confirmed by Rust tests at `frontmatter.rs:131-253`
- [x] No-frontmatter case returns `{ frontmatter: {}, bodyStart: 0 }` — confirmed at `frontmatter.rs:166-171`
- [x] Malformed YAML returns empty frontmatter but advances `bodyStart` — confirmed at `frontmatter.rs:186-193`
- [x] Non-object top-level YAML returns empty frontmatter — confirmed at `frontmatter.rs:228-233`
- [x] `adaptFrontmatter` TypeScript function correctly deserializes JSON → `{ frontmatter, bodyStart }` — confirmed at `adapter.ts:7-13`
- [x] `serde_yaml = "0.9"` declared in Cargo.toml — confirmed at `Cargo.toml:13`
- [x] `bodyStart` calculation matches TS regex `match[0].length` for valid inputs — verified manually for `basic_frontmatter`, `crlf_line_endings`, and `title: Test` cases
- [x] `ParserProvider` interface with 3 methods correctly defined — confirmed at `parser-provider.ts:12-21`
- [x] `TsParserProvider` delegates to existing TS functions — confirmed at `parser-provider.ts:28-40`
- [x] All new symbols exported from `@mdtree/core/index.ts` — confirmed at `index.ts:35-36`
- [x] Workspace package `@mdtree/parser-native` registered via `packages/*` glob in root `package.json` — confirmed at root `package.json:3`
- [x] `@mdtree/core` remains I/O-free — no WASM loading or file I/O added to core; only interface + class wrapping existing functions
- [x] 12 Rust unit tests covering all specified edge cases — confirmed by counting tests in `frontmatter.rs:131-253`
- [x] 10 TypeScript conformance tests comparing Rust vs TS output — confirmed in `frontmatter.test.ts`
- [x] No TODO/FIXME/debug statements in implementation — confirmed via grep