## Summary

- Tasks completed:
  - **[Critical] Fixed off-by-one in `find_closing_delimiter` line 75:** Changed guard from `i + 3 <= len` to `i + 4 <= len` — prevents WASM panic on truncated `\n---` closing delimiter
  - **[Critical] Fixed off-by-one in `find_closing_delimiter` line 90:** Changed guard from `i + 4 <= len` to `i + 5 <= len` — prevents WASM panic on truncated `\r\n---` closing delimiter
  - **[Warning] Added `console_error_panic_hook`:** Added dependency and `#[wasm_bindgen(start)]` init function so any future panics produce readable error messages in JavaScript console instead of opaque `RuntimeError: unreachable`
  - **[Warning] Added missing conformance tests:** Added "aliases as string" and "multiline values (strip block scalar)" test cases to both Rust unit tests and TypeScript conformance tests, as required by acceptance criteria

- Tests: **pass** — 167 TypeScript tests + 17 Rust unit tests = **184 total, all passing**

- Commits:
  - `fix(parser-native): fix off-by-one panics in frontmatter delimiter detection and add panic hook`