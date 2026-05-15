## Summary

- Tasks completed:
  1. ✅ **Fix: Empty meta-action icon** — Changed `Some(icon_val)` to `None` when `icon_val.is_empty()` at `inline_tokens.rs:131`, matching TS behavior where `icon || undefined` converts empty string to absent field.
  2. ✅ **Fix: Double-backtick code spans** — Replaced `find_closing_backtick` (single backtick) with `count_backticks` + `find_closing_backticks` (matching count of opening backticks for closing), supporting ```` `` ``, ``` `` ` ```, etc.
  3. ✅ **Fix: URL inside underscore emphasis** — Added `is_top_level` parameter to `parse_inline()` so recursive calls from emphasis parsing don't treat position 0 as a URL boundary (matching TS where `inlineHttpLinkPlugin` checks `(^|\s)` on original source).
  4. ✅ **Fix: Spec documentation** — Updated `spec.md` to document the 4-token padding behavior for standalone bold (was incorrectly saying "exactly TWO tokens").
  5. ✅ **Added regression tests** — 7 new Rust unit tests + 7 new TS conformance tests covering all fixed edge cases.

- Tests: **pass** — 112 Rust tests, 227 TypeScript tests (0 failures)
- Commits: `fix(parser-native): address code review findings for inline token parser`