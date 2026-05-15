# Tasks: rust-parser-02-frontmatter

## Task 1 — Add `serde_yaml` dependency to `Cargo.toml`

Modify `packages/parser-native/Cargo.toml`:

- Add `serde_yaml = "0.9"` under `[dependencies]`.
- This is required for full YAML parsing (scalars, arrays, nested objects, all types).

**Verification:** `cargo check` in `packages/parser-native/` succeeds with the new dependency.

---

## Task 2 — Implement `frontmatter.rs` Rust module

Create `packages/parser-native/src/frontmatter.rs`:

- Define a public struct `FrontmatterResult` with fields:
  - `frontmatter: serde_json::Value` (serialized as the JSON object)
  - `body_start: usize` (byte offset where body begins)
- Implement `pub fn parse_frontmatter(content: &str) -> FrontmatterResult`:
  1. Check if `content` starts with `---\n` or `---\r\n`. If not, return `FrontmatterResult { frontmatter: serde_json::Value::Object(Map::new()), body_start: 0 }`.
  2. Find the closing `---` delimiter: scan for `\n---\n` or `\n---\r\n` or `\n---` at EOF after the opening delimiter. The search starts after the first `---\n` (or `---\r\n`).
  3. Extract the YAML string between the two `---` markers.
  4. Calculate `body_start` as the byte length from the start of content to the end of the closing `---` line (including the trailing newline if present). This matches the TS behavior where `bodyStart = match[0].length` (the entire matched `---\n...\n---` block including the trailing newline of the opening `---` but the regex `^---\r?\n([\s\S]*?)\r?\n---` captures up to and including the final `---`).
  5. Parse the YAML string using `serde_yaml::from_str::<serde_yaml::Value>()`, then convert to `serde_json::Value` via `serde_json::to_value()`.
  6. If parsing fails (invalid YAML), return `FrontmatterResult { frontmatter: serde_json::Value::Object(Map::new()), body_start }` — empty object but still advance past the block.
  7. If the parsed YAML is not an object (e.g., a bare scalar or array at top level), return empty object with the correct `body_start`.
- Derive `serde::Serialize` on `FrontmatterResult` for JSON output.

**Key detail on `body_start` calculation:** The TS regex `^---\r?\n([\s\S]*?)\r?\n---` matches from start of string through the closing `---`. So `match[0].length` equals the number of characters from position 0 through the last character of `---` (the closing delimiter). It does NOT include any newline after the closing `---`. So `body_start` = index of closing `---` + 3.

**Verification:** `cargo check` passes; the module compiles.

---

## Task 3 — Wire `frontmatter.rs` into `lib.rs` and export via `wasm_bindgen`

Modify `packages/parser-native/src/lib.rs`:

- Add `mod frontmatter;` declaration.
- Add a `#[wasm_bindgen]` exported function:
  ```rust
  #[wasm_bindgen]
  pub fn parse_frontmatter(content: &str) -> String {
      let result = frontmatter::parse_frontmatter(content);
      serde_json::to_string(&result).unwrap_or_else(|_| r#"{"frontmatter":{},"bodyStart":0}"#.to_string())
  }
  ```
- The JSON output uses camelCase field names (`bodyStart` not `body_start`). Either use `#[serde(rename = "bodyStart")]` on the struct field, or rename during serialization. Using `#[serde(rename_all = "camelCase")]` on `FrontmatterResult` is the cleanest approach.

**Verification:** `cargo check` passes; `wasm-pack build --target web` succeeds.

---

## Task 4 — Write Rust unit tests for the frontmatter module

Create `packages/parser-native/src/frontmatter_tests.rs` (or use inline `#[cfg(test)] mod tests` in `frontmatter.rs`):

Tests to implement:
1. **Basic frontmatter:** Input `"---\ntitle: Hello\n---\nbody"` → frontmatter is `{"title": "Hello"}`, bodyStart = 18 (length of `"---\ntitle: Hello\n---"`).
2. **Array values:** Input `"---\naliases:\n  - Alias1\n  - Alias2\n---\n"` → frontmatter has `aliases: ["Alias1", "Alias2"]`.
3. **Nested object:** Input with nested YAML keys → frontmatter reflects nested structure.
4. **No frontmatter:** Input `"# Just a header\n- item"` → frontmatter is `{}`, bodyStart is 0.
5. **Empty frontmatter block:** Input `"---\n---\nbody"` → frontmatter is `{}`, bodyStart = 7.
6. **Malformed YAML:** Input `"---\n: invalid: yaml: [[[\n---\nbody"` → frontmatter is `{}`, bodyStart advances past the block.
7. **CRLF line endings:** Input with `\r\n` → correctly detects boundaries and produces same logical result.
8. **Boolean/number values:** Input `"---\ndraft: true\ncount: 42\n---\n"` → `{"draft": true, "count": 42}`.
9. **Null values:** Input `"---\nempty:\n---\n"` → `{"empty": null}`.
10. **Non-object top level YAML:** Input `"---\n- item1\n- item2\n---\n"` → frontmatter is `{}` (top-level must be object).
11. **String with obsidian link:** Input `"---\nparent: \"[[Root]]\"\n---\n"` → `{"parent": "[[Root]]"}`.
12. **Flow-style array:** Input `"---\ntags: [work, personal]\n---\n"` → `{"tags": ["work", "personal"]}`.

**Verification:** `cargo test` in `packages/parser-native/` passes all tests.

---

## Task 5 — Implement TypeScript adapter for frontmatter output

Create or extend `packages/parser-native/ts/adapter.ts`:

- Import `Frontmatter` type from `@mdtree/core` (which is `Record<string, unknown>`).
- Export function `adaptFrontmatter(json: string): { frontmatter: Frontmatter; bodyStart: number }`:
  ```typescript
  export function adaptFrontmatter(json: string): { frontmatter: Frontmatter; bodyStart: number } {
    const parsed = JSON.parse(json) as { frontmatter: Record<string, unknown>; bodyStart: number }
    return {
      frontmatter: parsed.frontmatter ?? {},
      bodyStart: parsed.bodyStart ?? 0,
    }
  }
  ```
- This is intentionally simple — `JSON.parse` deserializes YAML scalars/arrays/objects into their JS equivalents naturally.

**Verification:** TypeScript type-checks without errors (`bunx tsc --noEmit` in `packages/parser-native/`).

---

## Task 6 — Write TypeScript conformance tests

Create `packages/parser-native/ts/__tests__/frontmatter.test.ts`:

- Import `parseFrontmatter` from `@mdtree/core` (the TS reference implementation).
- Import `adaptFrontmatter` from `../adapter.ts`.
- Load the WASM module (from `../../pkg/parser_native_bg.wasm` using `Bun.file().arrayBuffer()`).
- Call the WASM `parse_frontmatter` function and adapt the result.
- Compare against the TS `parseFrontmatter` output using `expect(...).toEqual(...)` (deep equality).

Test cases:
1. **Fixture file: `aliases/meeting notes.md`** — has `aliases: [Meeting1, Meeting2]`.
2. **Fixture file: `multi-page/index.md`** — has `parent: "[[Root]]"`.
3. **Synthetic: tags array** — `"---\ntags:\n  - work\n  - personal\n---\nbody"`.
4. **Synthetic: tags string** — `"---\ntags: work\n---\nbody"`.
5. **Synthetic: no frontmatter** — `"# Just a header"`.
6. **Synthetic: empty frontmatter** — `"---\n---\nbody"`.
7. **Synthetic: nested objects** — `"---\nmetadata:\n  author: Jane\n  version: 2\n---\n"`.
8. **Synthetic: CRLF** — same content as case 1 but with `\r\n` line endings.
9. **Synthetic: malformed YAML** — `"---\n{invalid\n---\nbody"` → both return empty frontmatter.
10. **Synthetic: boolean/number** — `"---\ndraft: true\ncount: 5\n---\n"`.

Each test asserts:
- `rustResult.frontmatter` deep-equals `tsResult.frontmatter`
- `rustResult.bodyStart` equals `tsResult.bodyStart`

**Verification:** `bun test packages/parser-native/ts/__tests__/frontmatter.test.ts` passes (requires prior `wasm-pack build`).
