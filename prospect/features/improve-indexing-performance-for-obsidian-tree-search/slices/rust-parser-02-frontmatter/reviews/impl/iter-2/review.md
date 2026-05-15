### Critical (must fix before archiving)

(none)

### Warnings (should address or explicitly defer)

- [ ] **Proposal AC13 text in older path still omits `- [` condition** — The file at `prospect/features/rust-parser/slices/rust-parser-03-list-scanner/proposal.md:61` still reads "Pure-prose items (no `[[`, `![[`, `#`, or `http`) are skipped" (missing `- [`). The newer proposal at `prospect/features/improve-indexing-performance-for-obsidian-tree-search/slices/rust-parser-03-list-scanner/proposal.md:60` is correct. This stale text was flagged in the previous iteration and was not updated.

### Suggestions (consider before or after archiving)

(none)

### Verified

- [x] **[Previously Critical] `find_body_start_line` CRLF bug** — FIXED. `find_body_start_line` is now called on `raw_lines` (before `\r` stripping) at `list_scanner.rs:356`, so character counts correctly include `\r` bytes. Comments at lines 353-355 explain the rationale.
- [x] **[Previously Warning] No CRLF+bodyStart conformance test** — FIXED. Two TypeScript conformance tests added at `list-scanner.test.ts:182-200` ("CRLF content with non-zero frontmatter bodyStart" and "CRLF content with frontmatter and headers") plus three Rust unit tests at `list_scanner.rs:871-912` (`crlf_with_frontmatter_body_start`, `crlf_with_frontmatter_body_start_multi_items`, `fallback_when_body_start_exceeds_content`).
- [x] **[Previously Warning] Fallback behavior diverges from TS** — FIXED. Fallback at `list_scanner.rs:485` now returns `0` (scan from beginning, matching TS default `bodyStartLine = 0`) with clear comments at lines 483-484.