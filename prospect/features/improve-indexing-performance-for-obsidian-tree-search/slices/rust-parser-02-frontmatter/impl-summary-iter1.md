## Summary

- Tasks completed:
  1. **[Critical] Fixed `find_body_start_line` CRLF bug** — Moved the `find_body_start_line` call to operate on raw lines (before `\r` stripping), so character counts correctly align with `frontmatter_body_start` which was computed on the original CRLF content.
  2. **[Warning] Fixed fallback behavior** — Changed the fallback return from `lines.len()` (scan nothing) to `0` (scan everything), matching the TypeScript behavior where `bodyStartLine` defaults to 0.
  3. **[Warning] Added CRLF+bodyStart conformance tests** — Added 3 Rust unit tests and 2 TypeScript conformance tests that exercise CRLF content with non-zero frontmatter body start.

- Tests: **pass** — 61 Rust tests + 193 TypeScript tests (all packages, 0 failures)

- Commits: `fix(parser-native): fix CRLF body-start line calculation in list scanner`