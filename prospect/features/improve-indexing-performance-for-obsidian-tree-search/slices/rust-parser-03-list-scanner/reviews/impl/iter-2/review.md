### Critical (must fix before archiving)
(none)

### Warnings (should address or explicitly defer)
(none)

### Suggestions (consider before or after archiving)
(none)

### Verified
- [x] **[Previously Warning] Empty meta-action icon produces `icon: ""` instead of absent field** — Fixed at `packages/parser-native/src/inline_tokens.rs:133-134`. Now checks `if icon_val.is_empty() { None } else { Some(icon_val.to_string()) }`, matching TS `icon || undefined` behavior. Regression test at line 1638-1650 confirms `icon: None` for empty value. TS conformance test at `inline-tokens.test.ts:182-185` validates against actual TS parser.
- [x] **[Previously Warning] Spec states bold produces "exactly TWO tokens" but implementation produces 4 (with padding)** — Fixed at `spec.md:134`. The spec now includes a `**Note:**` explaining that standalone bold produces FOUR tokens (padding, bold opener, content, padding) due to markdown-it's behavior. Implementation test at `inline_tokens.rs:1755-1763` (`test_standalone_bold`) explicitly asserts 4 tokens. TS conformance test at `inline-tokens.test.ts:208-210` validates Rust matches TS.
- [x] **[Previously Warning] Double-backtick code spans not handled** — Fixed at `packages/parser-native/src/inline_tokens.rs:536-563`. New `count_backticks()` (line 537) counts opening backtick run length, and `find_closing_backticks()` (line 549) matches the exact same count. Used at line 275-285 to handle multi-backtick code spans. Regression tests at lines 1653-1678 (single backtick, double backtick, double with single inside) and line 1741-1752 (triple backtick) confirm correct behavior. TS conformance tests at `inline-tokens.test.ts:187-194` validate against TS parser.
- [x] **[Previously Warning] URL inside underscore emphasis parsed differently than TS** — Fixed at `packages/parser-native/src/inline_tokens.rs:260`. The `parse_inline` function now accepts `is_top_level` parameter. Top-level call at line 245 passes `true`; recursive calls from emphasis at lines 791, 834, 882 pass `false`. At line 352, URL boundary check is `(i == 0 && is_top_level) || (i > 0 && is_whitespace)`, ensuring position 0 within emphasis inner content is NOT treated as a URL boundary. Regression test at lines 1681-1701 confirms `_https://example.com_` produces italic+text (not italic+link). TS conformance test at `inline-tokens.test.ts:197-199` validates.
- [x] **[Previously Suggestion] Add conformance test for empty meta-action icon** — Added at `packages/parser-native/ts/__tests__/inline-tokens.test.ts:182-185`. Test uses `"text (meta-action-name::X)(meta-action-url::Y)(meta-action-icon::)"` and confirms deep equality with TS parser output.
- [x] **[Previously Suggestion] Add conformance test for bare bold/italic without surrounding text** — Added at `packages/parser-native/ts/__tests__/inline-tokens.test.ts:208-215`. Tests `"**bold**"` and `"*italic*"` as standalone inputs, validating padding token behavior matches TS output exactly.