### Critical (must fix before implementation)

(none)

### Warnings (should address, discuss if not)

- [ ] **`shouldSkip` logic omits `!text.includes("- [")` check** — The TS `shouldSkip` function at `packages/core/src/parser/list-scanner.ts:20` checks five conditions for pure prose detection: `[[`, `![[`, `#`, `http`, AND `- [`. The proposal AC13 says "no `[[`, `![[`, `#`, or `http`", the spec Requirement 1 scenario says "Pure prose list items are skipped" without specifying the full conditions, and Task 2 step 4 says `shouldSkip` "returns true if text has no `[[`, `![[`, `#`, or `http`" — all omitting the `"- ["` check. This means an item like `- see item - [x] done` (text referencing task syntax) would be incorrectly skipped by the Rust implementation. No existing fixture exercises this pattern, so conformance tests won't catch it. — `proposal.md:AC13` + `tasks.md:46` + `spec.md:26-27`

### Suggestions (think about these, optional)

- [ ] **Consider specifying `.trim()` behavior explicitly at all three points** — The TS code trims text at three separate points: initial capture (`listMatch[2].trim()`, line 99), task extraction (`taskMatch[2].trim()`, line 105), and post-meta-strip (line 109). Task 2 step 4 only mentions "Trim text after stripping" (the third point). The first two trims handle trailing whitespace after regex capture. Since no fixtures have trailing whitespace, conformance tests won't catch omission of the earlier trims. Adding explicit trim mentions or a trailing-whitespace synthetic test to Task 6 would prevent subtle bugs. — `tasks.md:39-42` (Task 2, steps 3-4)

- [ ] **Consider specifying header text `.trim()` explicitly** — The TS code trims header text at `headerMatch[2].trim()` (`list-scanner.ts:74`). This affects both the `heading` field in `HeadingCache` and the `section.subpath` value (`#${heading}`). Task 2 step 3 says "Match `^(#{1,6})\s+(.*)` → push to `headers`" without mentioning trim. If a fixture or user file has trailing whitespace on a header line, the Rust implementation would produce different `section.subpath` values. — `tasks.md:36` (Task 2, step 3)

### Confirmed Coverage

- [x] **Acceptance criteria** — present, comprehensive (22 criteria), covering all major behaviors
- [x] **Regex patterns** — all six regex patterns in the spec/tasks match the TS implementation exactly
- [x] **Meta-action/meta-mdtree stripping with rawText preservation** — spec Requirement 4 covers all cases including the subtle "rawText ≠ text means not skipped" behavior
- [x] **Parent-child wiring via indent stack** — spec Requirement 2 with 6 scenarios covers nesting, de-dent, header reset
- [x] **Section subpath tracking** — spec Requirement 3 with 3 scenarios covers before-header, update-on-header, and header text in subpath
- [x] **Archive tag filtering** — spec Requirement 5 covers both positive and negative cases, correctly using `#`-prefixed tag
- [x] **Frontmatter body-start offset** — spec Requirement 6 with correct arithmetic (ASCII fixtures ensure byte/char equivalence)
- [x] **WASM export and adapter** — spec Requirement 7 covers JSON validity and `null → undefined` conversion for `parent`
- [x] **Conformance testing approach** — Task 6 correctly specifies running both parsers on all fixture files with same parameters
- [x] **Position field naming** — Tasks correctly use `col` for DvList positions and `ch` for HeadingCache positions (matching types.ts)
- [x] **`NativeParserHandle` type extension** — Task 3 correctly extends the type in `packages/parser-native/ts/index.ts`
- [x] **Non-goals correctly scoped** — doesn't touch `parseVaultFile`, batch API, inline tokens, or graph construction
- [x] **Dependency on slices 01/02** — both verified complete in codebase (Cargo workspace, wasm-pack, WASM loading all in place)
- [x] **Rust test count (≥35)** — Task 4 lists 35 specific test names covering all scanner behaviors