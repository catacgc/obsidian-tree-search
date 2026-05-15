### Critical (must fix before archiving)
(none)

### Warnings (should address or explicitly defer)
- [ ] **Empty meta-action icon produces `icon: ""` instead of absent field** — When input contains `(meta-action-icon::)` (empty value between `::` and `)`), the Rust produces `Some("")` which serializes to `"icon": ""`. The TS equivalent evaluates `"" || undefined` → `undefined`, meaning the `icon` field is absent. This violates the "structurally identical output" acceptance criterion for this edge case. No existing test triggers this (fixtures lack meta-action-icon, synthetic tests use non-empty icons). Fix: add `if icon_val.is_empty() { None } else { Some(icon_val) }` at line 131. — `packages/parser-native/src/inline_tokens.rs:131`
- [ ] **Spec states bold produces "exactly TWO tokens" but implementation produces 4 (with padding)** — The spec (`spec.md:131-133`) says `"**bold content**"` produces exactly 2 tokens, but the Rust unit test `test_bold_two_tokens` (line 1212) expects 4 tokens including leading/trailing empty text padding tokens. If the conformance tests pass (as claimed), the implementation is correct and the spec is wrong — but the spec should be updated to match actual behavior to avoid confusing future maintainers. — `spec.md:131` vs `packages/parser-native/src/inline_tokens.rs:1212`
- [ ] **Double-backtick code spans (` `` `) not handled** — The Rust `find_closing_backtick` (line 521-529) only searches for a single backtick. In markdown-it, ` `` code `` ` uses double backticks as delimiters for code spans. The Rust would incorrectly parse ` ``code`` ` as: code("") + text("code``"). No fixture or test triggers this, but it's a known divergence from markdown-it behavior for users who use double-backtick code spans in list items. — `packages/parser-native/src/inline_tokens.rs:521-529`
- [ ] **URL inside underscore emphasis parsed differently than TS** — For input like `"_https://example.com_"`, the Rust processes emphasis first (wrapping the URL), then parses the inner content as a bare URL (producing italic+Link). The TS's `inlineHttpLinkPlugin` runs at the core level first and fails to match (no whitespace boundary before URL inside `_`), so markdown-it treats the inner content as plain text (producing italic+Text). This only triggers when bare URLs are directly wrapped in `_` emphasis without intervening whitespace. — `packages/parser-native/src/inline_tokens.rs:407-441` vs `packages/core/src/parser/inline-tokens.ts:9-16`

### Suggestions (consider before or after archiving)
- [ ] **Add conformance test for empty meta-action icon** — Include `"text (meta-action-name::X)(meta-action-url::Y)(meta-action-icon::)"` in the synthetic conformance tests to catch the `icon: ""` vs absent divergence. — `packages/parser-native/ts/__tests__/inline-tokens.test.ts`
- [ ] **Add conformance test for bare bold/italic without surrounding text** — Include `"**bold**"` and `"*italic*"` as standalone inputs in synthetic tests to verify the padding token behavior matches TS output exactly. Current tests only have `"**important** note"` (with trailing text). — `packages/parser-native/ts/__tests__/inline-tokens.test.ts`
- [ ] **CRLF (`\r\n`) in inline content produces extra `\r` in text** — The softbreak handler only detects `\n` (line 445). If input contains `\r\n`, the `\r` accumulates in text_buf, producing a text token with trailing `\r`. This is unlikely in practice (list items are single lines) but could cause divergence if multiline content reaches `parse_tokens`. — `packages/parser-native/src/inline_tokens.rs:445`

### Verified
- [x] AC 1: `inline_tokens.rs` exists with public `parse_tokens` function — confirmed at `packages/parser-native/src/inline_tokens.rs:221`
- [x] AC 2: Rust unit tests ≥42 — confirmed 44 tests in the `#[cfg(test)] mod tests` block
- [x] AC 3-7: Obsidian link parsing (simple, alias, header, header+alias, folder) — confirmed correct at tests lines 866-954 with correct `resolve_reference` behavior
- [x] AC 8: Markdown links `[text](url)` — confirmed at `try_parse_markdown_link` (line 630) and test line 1037
- [x] AC 9: Images with alt always as String — confirmed `alt: String` type (line 33) and test line 1076
- [x] AC 10: Bare HTTP URLs — confirmed at `try_parse_bare_url` (line 687) and test line 1126
- [x] AC 11: Two-token pattern for emphasis — confirmed implementation at lines 348-404 with force_flush + needs_trailing mechanism
- [x] AC 12: Plain text tokens — confirmed at line 455-458 and test line 1562
- [x] AC 13-14: Meta-action and meta-mdtree extraction — confirmed at `extract_meta_actions` (line 52) and `extract_meta_mdtree` (line 145)
- [x] AC 15: Meta tokens removed from inline input — confirmed: extraction runs before `parse_inline` at lines 223-226
- [x] AC 16: Input trimmed after meta extraction — confirmed at line 229
- [x] AC 17: Output ordering (inline, meta-action, meta-mdtree) — confirmed at lines 243-245 and test line 1591
- [x] AC 18: `#[wasm_bindgen]` export returns valid JSON — confirmed at `lib.rs:31-35`
- [x] AC 19: `adaptParseTokens` in adapter.ts — confirmed at `adapter.ts:76-78`
- [x] AC 20: `NativeParserHandle` and `WasmExports` extended — confirmed at `index.ts:8` and `loader.ts:5`
- [x] AC 21: Fixture-derived conformance tests — confirmed at `inline-tokens.test.ts:44-82`
- [x] AC 22: 19 synthetic conformance tests — confirmed at `inline-tokens.test.ts:84-179`
- [x] AC 23: `skip_serializing_if` for optional fields, `Image.alt` always present — confirmed at types definition lines 18-21, 27-28, 33, 39, 46
- [x] AC 24: No regex crate in Cargo.toml — confirmed at `Cargo.toml` (only serde, serde_json, serde_yaml, wasm-bindgen, console_error_panic_hook)
- [x] `resolveReference` uses `split("/")[1]` (index 1, not last) — confirmed at line 209 and test `test_obsidian_link_deep_folder` line 940
- [x] `![[File]]` handled as `!` + obsidian link, not image — confirmed at lines 298-304 and test line 1088
- [x] Code spans prevent inner parsing — confirmed at lines 264-279 and test line 1364
- [x] No TODO/FIXME comments — confirmed via grep
- [x] No regex crate dependency — confirmed via Cargo.toml review
- [x] Module properly declared in lib.rs — confirmed at `lib.rs:4`
- [x] All existing exports from adapter.ts and index.ts maintained — confirmed includes `adaptFrontmatter`, `adaptScanResult`, `adaptParseTokens`