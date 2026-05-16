### Critical (must fix before archiving)
(none)

### Warnings (should address or explicitly defer)
(none)

### Suggestions (consider before or after archiving)
(none)

### Verified
- [x] **[Previously Warning] Rust test `parse_single_file_matches_batch` is trivially true** — RESOLVED. The test at `packages/parser-native/src/lib.rs:516-547` now calls both actual `#[wasm_bindgen]` entry points (`batch_parse_chunk` at line 530 via JSON serialization of `Vec<BatchFileInput>`, and `parse_single_file` at line 533 with individual parameters), deserializes both JSON outputs, and asserts structural equality. This tests the JSON deserialization path in `batch_parse_chunk` (line 45: `serde_json::from_str`) and the direct-construction path in `parse_single_file` (lines 52-57), confirming they produce identical results through different code paths.