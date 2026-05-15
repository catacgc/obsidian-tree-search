# Slice Proposal: rust-parser-02-frontmatter

## Problem & Outcome

**Problem:** The TypeScript `parseFrontmatter` function in `packages/core/src/parser/frontmatter.ts` uses `js-yaml` to parse YAML frontmatter on every markdown file during indexing. For a vault with N files, this means N YAML parses in single-threaded JavaScript. On mobile, `js-yaml`'s pure-JS YAML parser is a significant contributor to indexing latency. The Rust/WASM scaffold from slice 01 is in place, but the `frontmatter.rs` module is empty — no actual parsing logic exists in Rust yet.

**Outcome:** After this slice, `packages/parser-native/src/frontmatter.rs` contains a complete Rust frontmatter parser that: (a) detects `---` boundary delimiters, (b) parses the full YAML content between delimiters into an arbitrary key-value structure (supporting scalars, arrays, nested objects), and (c) returns the parsed frontmatter as a JSON-serializable structure plus the byte offset where the markdown body begins. A TypeScript adapter function in `packages/parser-native/ts/adapter.ts` deserializes the WASM JSON output into the existing `Frontmatter` type (`Record<string, unknown>`). A conformance test suite verifies that the Rust parser produces identical output to the TS `parseFrontmatter` for all existing fixture inputs and edge cases.

## What Changes

1. In `packages/parser-native/Cargo.toml`:
   - Add `serde_yaml = "0.9"` (or `unsafe-libyaml` if size is a concern) as a dependency for full YAML parsing

2. In `packages/parser-native/src/frontmatter.rs` (new file):
   - Implement `---` delimiter detection (matching the regex `^---\r?\n([\s\S]*?)\r?\n---` behavior)
   - Parse YAML content between delimiters using `serde_yaml` into `serde_json::Value`
   - Return a struct containing `frontmatter: serde_json::Value` and `body_start: usize`
   - Handle error cases: no frontmatter returns empty object + body_start=0; invalid YAML returns empty object

3. In `packages/parser-native/src/lib.rs`:
   - Add `mod frontmatter;`
   - Export a `#[wasm_bindgen]` function `parse_frontmatter(content: &str) -> String` that calls the Rust parser and returns JSON

4. In `packages/parser-native/ts/adapter.ts` (new or extended file):
   - Add a `adaptFrontmatter(json: string): { frontmatter: Frontmatter; bodyStart: number }` function that deserializes the WASM output

5. In `packages/parser-native/src/tests/` (new test files):
   - Rust unit tests for frontmatter boundary detection, YAML parsing, error handling

6. In `packages/parser-native/ts/__tests__/frontmatter.test.ts` (new file):
   - Conformance tests comparing Rust output against TS `parseFrontmatter` output for various inputs

## Scope

**In-scope:**
- Rust frontmatter boundary detection (`---\n...\n---`)
- Full YAML parsing in Rust (scalars, arrays, nested objects, all types)
- Correct `bodyStart` offset calculation matching TS behavior
- Error handling (malformed YAML returns empty object, missing frontmatter returns empty object + bodyStart=0)
- `#[wasm_bindgen]` export of `parse_frontmatter` function
- TypeScript adapter deserializing JSON output to `{ frontmatter: Frontmatter; bodyStart: number }`
- Rust unit tests covering boundary detection, YAML parsing variants, error paths
- TypeScript conformance tests comparing Rust vs TS parser output on fixture files
- Adding `serde_yaml` dependency to Cargo.toml

**Non-goals (explicitly excluded):**
- Implementing `extractAliases`, `extractTags`, or `extractParents` in Rust (these remain TS-only helpers operating on the returned `Frontmatter` object)
- Modifying any existing file in `packages/core/` (the TS `parseFrontmatter` remains unchanged as fallback)
- Integrating the Rust frontmatter parser into `parseVaultFile` or the `ParserProvider` flow (that's slice 06)
- Implementing `scanMarkdown` or `parseTokens` in Rust (slices 03 and 04)
- Optimizing WASM binary size (slice 09 CI will gate on size; this slice just adds the dep)
- Batch API or event-loop yielding concerns

## Acceptance Criteria

1. `packages/parser-native/src/frontmatter.rs` exists and contains a public `parse_frontmatter` function.
2. Running `cargo test` in `packages/parser-native/` passes all Rust unit tests for the frontmatter module.
3. The Rust parser correctly detects `---\n...\n---` boundaries and returns the YAML content between them.
4. The Rust parser returns `bodyStart` equal to the byte length of the entire frontmatter block (including both `---` delimiters and trailing newline), matching the TS regex behavior (`match[0].length`).
5. The Rust parser handles all YAML value types: strings, numbers, booleans, null, arrays (flow and block), and nested objects — returning them as their JSON equivalents.
6. When no frontmatter is present (no leading `---`), the Rust parser returns `{ "frontmatter": {}, "bodyStart": 0 }`.
7. When frontmatter YAML is malformed/unparseable, the Rust parser returns `{ "frontmatter": {}, "bodyStart": <offset> }` (matching TS error behavior where bodyStart still advances past the `---` block).
8. The `#[wasm_bindgen]` exported `parse_frontmatter(content: &str) -> String` function returns valid JSON matching the schema `{ "frontmatter": object, "bodyStart": number }`.
9. `packages/parser-native/ts/adapter.ts` exports an `adaptFrontmatter` function that converts the JSON string into `{ frontmatter: Frontmatter; bodyStart: number }`.
10. A TypeScript conformance test loads the WASM module, calls `parse_frontmatter` on every `.md` fixture file that contains frontmatter, and asserts deep equality between the Rust output (via adapter) and the TS `parseFrontmatter` output.
11. The conformance test covers at minimum: aliases as array, aliases as string, tags as array, tags as string, parent as string with obsidian link, nested objects, empty frontmatter block, no frontmatter, multiline values, and CRLF line endings.
12. Running `wasm-pack build --target web` in `packages/parser-native/` still succeeds (no build regressions).
13. The `serde_yaml` dependency is declared in `Cargo.toml` with appropriate version constraint.

## Feature Mapping

- **Source feature:** Improve indexing performance for obsidian-tree-search (Rust WASM parser)
- **Slice item:** `rust-parser-02-frontmatter`
