## Summary

- Tasks completed: Fixed the accepted warning from the code review — the `parse_single_file_matches_batch` Rust test now exercises both actual WASM entry points (`batch_parse_chunk` and `parse_single_file`) rather than calling the same internal function twice.
- Tests: **PASS** — 137 Rust tests + 237 TypeScript tests = 374 total, 0 failures
- Commits: `fix(parser-native): make parse_single_file_matches_batch test non-trivial`