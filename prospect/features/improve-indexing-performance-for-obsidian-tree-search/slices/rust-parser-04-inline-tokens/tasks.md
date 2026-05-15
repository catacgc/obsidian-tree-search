# Tasks: rust-parser-04-inline-tokens

## Task 1 — Create `inline_tokens.rs` with serde output types and declare module

**Create `packages/parser-native/src/inline_tokens.rs`:**

- Define serde-serializable output types using tagged enums to mirror the `ParsedTextToken` union type. Use `#[serde(tag = "tokenType")]` for the enum and rename fields as needed. Use `#[serde(skip_serializing_if = "Option::is_none")]` for optional fields (`alias`, `headerName`, `icon`, `content`). Note: `alt` on `Image` is NOT optional — it is always a `String` (matching TS behavior at `inline-tokens.ts:124` where `token.content || token.attrs?.[1]?.[1] || ""` always yields a string):

  ```rust
  use serde::Serialize;

  #[derive(Serialize, Clone, Debug, PartialEq)]
  #[serde(tag = "tokenType")]
  pub enum ParsedToken {
      #[serde(rename = "text")]
      Text {
          text: String,
          decoration: String, // "none", "bold", "italic", "strikethrough", "code"
      },
      #[serde(rename = "obsidian_link")]
      ObsidianLink {
          source: String,
          #[serde(rename = "pageTarget")]
          page_target: String,
          #[serde(skip_serializing_if = "Option::is_none")]
          alias: Option<String>,
          #[serde(skip_serializing_if = "Option::is_none")]
          #[serde(rename = "headerName")]
          header_name: Option<String>,
      },
      #[serde(rename = "link")]
      Link {
          href: String,
          #[serde(skip_serializing_if = "Option::is_none")]
          content: Option<String>,
      },
      #[serde(rename = "image")]
      Image {
          src: String,
          alt: String,  // ALWAYS present (never Option) — matches TS which always produces a string
      },
      #[serde(rename = "meta_action")]
      MetaAction {
          name: String,
          url: String,
          #[serde(skip_serializing_if = "Option::is_none")]
          icon: Option<String>,
      },
      #[serde(rename = "meta_mdtree")]
      MetaMdtree {
          directive: String,
      },
  }
  ```

**Modify `packages/parser-native/src/lib.rs`:**

- Add `mod inline_tokens;` declaration alongside the existing `mod frontmatter;` and `mod list_scanner;`.

**Verification:** `cargo check` passes.

---

## Task 2 — Implement `parse_tokens` function body (meta extraction + inline state machine)

Implement the public function in `inline_tokens.rs`:

```rust
pub fn parse_tokens(input: &str) -> Vec<ParsedToken>
```

**Step 1: Meta-action triple extraction (hand-written parser with capture).**

- Extend the existing `find_meta_action_end` pattern from `list_scanner.rs:238-275` to CAPTURE the values (name, url, icon) instead of just stripping.
- Write a function `extract_meta_actions(input: &str) -> (String, Vec<ParsedToken>)` that:
  - Scans for `(meta-action-name::` prefix
  - Extracts the name value up to `)` — this is group 1
  - Immediately after, expects `(meta-action-url::` and extracts the url value up to `)` — this is group 2
  - Optionally, immediately after, expects `(meta-action-icon::` and extracts the icon value up to `)` — this is group 3
  - Removes the entire matched triple from the string
  - Collects all found triples into a `Vec<ParsedToken::MetaAction>`
  - Returns the cleaned string and the collected meta-action tokens
- The matching pattern is equivalent to the TS regex: `\(meta-action-name::([^)]*)\)\(meta-action-url::([^)]*)\)(?:\(meta-action-icon::([^)]*)\))?`
- This must handle multiple non-overlapping matches globally.

**Step 2: Meta-mdtree directive extraction (hand-written parser with capture).**

- Extend the existing `find_meta_mdtree_end` pattern from `list_scanner.rs:298-329` to CAPTURE the directive word.
- Write a function `extract_meta_mdtree(input: &str) -> (String, Vec<ParsedToken>)` that:
  - Scans for `(meta-mdtree::` prefix
  - Skips optional whitespace
  - Captures the `\w+` word (the directive)
  - Expects closing `)`
  - Removes the matched expression from the string
  - Returns cleaned string and collected `Vec<ParsedToken::MetaMdtree>`
- This must handle multiple matches globally.

**Step 3: Trim the cleaned string.**

- `let cleaned = cleaned.trim();`
- If `cleaned` is empty, return the meta tokens directly (no inline parsing needed).

**Step 4: Inline parsing state machine.**

Implement a character-by-character state machine on `cleaned` that detects (in priority order):

1. **Inline code** (`` ` ``): HIGHEST PRIORITY. When a backtick is encountered, scan for the next backtick. Content within backticks is NOT parsed for inner syntax (links, decorations, etc.). Produce `ParsedToken::Text { text, decoration: "code" }`. This is the one decoration type that produces a SINGLE token with the content text. If no closing backtick is found, treat the backtick as plain text.

2. **Obsidian links** (`[[`): When `[[` is encountered, scan forward for `]]`. Extract the content between them. Split on `|` to separate `[target_with_header, alias]`. Split the target portion on `#` to get `[fileName, headerName]`. Apply `resolve_reference(fileName)`: if fileName contains `/`, return `fileName.split("/")[1]` (the second segment at index 1, matching the TS implementation at `inline-tokens.ts:57`). Produce `ParsedToken::ObsidianLink`. If no closing `]]` is found, treat `[[` as plain text.

3. **Images** (`![`): When `![` is encountered and the next character is NOT `[` (which would be `![[`, an obsidian embed): scan for `]` to get alt text, then expect `(` and scan for `)` to get src. Produce `ParsedToken::Image { src, alt }` where `alt` is always a `String` (use `""` if empty). If the pattern doesn't complete (no `](...)` found), treat `![` as plain text.

4. **Markdown links** (`[` not preceded by `!`): When `[` is encountered (and not the second `[` in `[[`), scan for `]`, then expect `(` and scan for `)` to get href. The text between `[` and `]` is the content. Produce `ParsedToken::Link { href, content: Some(text) }`. If the pattern doesn't complete, treat `[` as plain text.

5. **HTTP URLs**: When `http://` or `https://` is detected at a word boundary (preceded by start-of-string or whitespace, and NOT preceded by `[` or `<`), scan forward consuming characters matching `[^\s\])}>,]+` (non-whitespace, non-`]`, non-`)`, non-`}`, non-`>`, non-`,`). Produce `ParsedToken::Link { href: url, content: Some(url) }`. The URL detection must NOT fire when the URL is already inside markdown link `[...](URL)` syntax — this is naturally handled by the fact that URLs inside `(...)` are already consumed by the markdown link parser in rule 4.

6. **Bold** (`**`): When `**` is encountered, scan for the matching closing `**`. To match the TS/markdown-it behavior, produce TWO tokens: `ParsedToken::Text { text: "".to_string(), decoration: "bold".to_string() }` followed by the enclosed text being parsed as normal content (which typically yields a `ParsedToken::Text { text: enclosed_content, decoration: "none" }` unless it contains inner tokens like links). If no closing `**` is found, treat the `**` as plain text.

7. **Italic** (single `*` or `_`): When a single `*` (not part of `**`) or `_` is encountered, scan for the matching closer. Produce TWO tokens: `ParsedToken::Text { text: "".to_string(), decoration: "italic".to_string() }` followed by the enclosed content parsed as inline. If no closing marker is found, treat it as plain text.

8. **Strikethrough** (`~~`): When `~~` is encountered, scan for the next `~~`. Produce TWO tokens: `ParsedToken::Text { text: "".to_string(), decoration: "strikethrough".to_string() }` followed by the enclosed content parsed as inline. If no closing `~~` is found, treat it as plain text.

9. **Plain text**: Any characters not consumed by the above rules accumulate into a plain text buffer. When a special token is encountered (or end of input), flush the buffer as `ParsedToken::Text { text, decoration: "none" }`. Empty text buffers should NOT produce tokens.

**Critical: Two-token pattern for emphasis/strikethrough (matching TS behavior).**

The TypeScript `parseTokenList` function at `inline-tokens.ts:106-116` processes markdown-it tokens where `strong_open`, `em_open`, `s_open` all have `content: ""` (empty string). This means:
- For `**bold text**`, markdown-it produces tokens: `strong_open` (content=""), `text` (content="bold text"), `strong_close`
- The TS `parseTokenList` emits: `{ text: "", decoration: "bold" }` then `{ text: "bold text", decoration: "none" }`
- For `*italic*`: `{ text: "", decoration: "italic" }` then `{ text: "italic", decoration: "none" }`
- For `~~struck~~`: `{ text: "", decoration: "strikethrough" }` then `{ text: "struck", decoration: "none" }`
- For `` `code` ``: ONLY one token: `{ text: "code", decoration: "code" }` (because `code_inline` in markdown-it is a single token with content)

The Rust state machine MUST replicate this exact two-token pattern for bold/italic/strikethrough, and the single-token pattern for inline code.

**Important edge case: `![[File]]` (obsidian embed).**

When `!` precedes `[[`, the `!` is accumulated as plain text, and then `[[File]]` is parsed as an obsidian link. This matches the TS behavior where the obsidian_link rule only fires at the `[[` position, leaving the preceding `!` as text. The image rule (`![`) requires `![...](...)`; since `![[File]]` has no `](...)`, the image rule fails and `!` stays as text.

**Step 5: Combine results.**

- Return `[...inline_tokens, ...meta_actions, ...meta_mdtrees]` (matching TS line 154 order).

**Verification:** `cargo check` passes; function compiles without errors.

---

## Task 3 — Add `#[wasm_bindgen]` export in `lib.rs` and update TypeScript types

**Modify `packages/parser-native/src/lib.rs`:**

- Add the exported function:
  ```rust
  #[wasm_bindgen]
  pub fn parse_tokens(text: &str) -> String {
      let result = inline_tokens::parse_tokens(text);
      serde_json::to_string(&result).unwrap_or_else(|_| "[]".to_string())
  }
  ```

**Modify `packages/parser-native/ts/loader.ts`:**

- Add `parse_tokens` to `WasmExports` type:
  ```typescript
  export type WasmExports = {
    ping: () => string
    parse_frontmatter: (content: string) => string
    scan_markdown: (content: string, file_path: string, frontmatter_body_start: number, archive_tag: string) => string
    parse_tokens: (text: string) => string
  }
  ```
- Add `parse_tokens: glue.parse_tokens` to the returned object in the `loadWasm` function.
- Add `parse_tokens` to the glue type in the dynamic import.

**Modify `packages/parser-native/ts/index.ts`:**

- Update `NativeParserHandle` type to include:
  ```typescript
  parse_tokens: (text: string) => string
  ```
- Update `loadNativeParser` to include `parse_tokens` in the returned handle (it is already returned from `loadWasm`).

**Verification:** `wasm-pack build --target web --out-dir pkg` succeeds; TypeScript type-checks.

---

## Task 4 — Write Rust unit tests (>=42 tests)

Add `#[cfg(test)] mod tests` block at the bottom of `inline_tokens.rs`:

**Obsidian link parsing (10 tests):**
1. `test_simple_obsidian_link` — `"[[Note]]"` → 1 token: ObsidianLink with source="[[Note]]", pageTarget="Note", alias=None, headerName=None
2. `test_obsidian_link_with_alias` — `"[[Note|Display]]"` → pageTarget="Note", alias=Some("Display")
3. `test_obsidian_link_with_header` — `"[[Note#Section]]"` → pageTarget="Note", headerName=Some("Section")
4. `test_obsidian_link_with_header_and_alias` — `"[[Note#Section|Alias]]"` → all three fields
5. `test_obsidian_link_with_folder` — `"[[folder/Note]]"` → pageTarget="Note" (resolveReference: split("/")[1])
6. `test_obsidian_link_deep_folder` — `"[[a/b/Note]]"` → pageTarget="b" (split("/")[1] takes index 1, NOT last segment)
7. `test_obsidian_link_text_around` — `"before [[Link]] after"` → 3 tokens: text("before "), ObsidianLink, text(" after")
8. `test_multiple_obsidian_links` — `"[[A]] and [[B]]"` → ObsidianLink(A), text(" and "), ObsidianLink(B)
9. `test_unclosed_obsidian_link` — `"[[Unclosed"` → treated as plain text (text token(s) containing the characters)
10. `test_empty_obsidian_link` — `"[[]]"` → ObsidianLink with pageTarget=""

**Markdown link and image parsing (6 tests):**
11. `test_markdown_link` — `"[text](http://example.com)"` → Link { href: "http://example.com", content: Some("text") }
12. `test_markdown_link_empty_text` — `"[](http://x.com)"` → Link { href: "http://x.com", content: Some("") }
13. `test_image` — `"![alt text](image.png)"` → Image { src: "image.png", alt: "alt text" }
14. `test_image_no_alt` — `"![](image.png)"` → Image { src: "image.png", alt: "" } (NOT alt: None — TS always produces a string)
15. `test_obsidian_embed_not_image` — `"![[File]]"` → text("!") followed by ObsidianLink with source `"[[File]]"`, pageTarget `"File"` (the `!` is plain text because `![[` is not a valid image pattern, and `[[File]]` is parsed as obsidian link)
16. `test_link_with_special_chars` — `"[docs](https://example.com/path?q=1&r=2)"` → correct href preserved

**HTTP URL detection (5 tests):**
17. `test_bare_https_url` — `"https://example.com"` → Link { href: url, content: Some(url) }
18. `test_bare_http_url` — `"http://example.com"` → Link token
19. `test_url_after_text` — `"see https://x.com"` → text("see "), Link
20. `test_url_not_in_brackets` — `"[https://x.com](https://x.com)"` → single Link (URL not double-detected because it's already consumed by the markdown link parser)
21. `test_url_terminated_at_special_chars` — `"https://x.com/path) more"` → Link { href: "https://x.com/path" }, then text(") more") — the `)` terminates the URL per the `[^\s\])}>,]+` rule and remains in subsequent text

**Text decoration — two-token pattern (10 tests):**
22. `test_bold_two_tokens` — `"**bold text**"` → TWO tokens: Text { text: "", decoration: "bold" } then Text { text: "bold text", decoration: "none" }
23. `test_italic_star_two_tokens` — `"*italic*"` → Text { text: "", decoration: "italic" } then Text { text: "italic", decoration: "none" }
24. `test_italic_underscore_two_tokens` — `"_italic_"` → Text { text: "", decoration: "italic" } then Text { text: "italic", decoration: "none" }
25. `test_strikethrough_two_tokens` — `"~~struck~~"` → Text { text: "", decoration: "strikethrough" } then Text { text: "struck", decoration: "none" }
26. `test_inline_code_single_token` — `` "`code here`" `` → SINGLE token: Text { text: "code here", decoration: "code" } (code is the exception — one token)
27. `test_bold_with_surrounding_text` — `"plain **bold** plain"` → text("plain "), text("", bold), text("bold", none), text(" plain")
28. `test_unclosed_bold` — `"**unclosed"` → treated as plain text (no decoration token produced)
29. `test_code_preserves_special` — `` "`[[not a link]]`" `` → SINGLE token: Text { text: "[[not a link]]", decoration: "code" }, no obsidian_link token
30. `test_italic_with_link_inside` — `"*see [[Note]]*"` → text("", italic), ObsidianLink(Note), text empty pieces — or more precisely, the inner content of emphasis is parsed for inline tokens, but each still gets decoration "none" since the emphasis opener already emitted the "italic" marker
31. `test_bold_empty_content` — `"****"` → text("", bold), no content text token (empty content after trim)

**Meta-action extraction (6 tests):**
32. `test_meta_action_triple` — `"text (meta-action-name::Open)(meta-action-url::https://x.com)"` → text("text") token + MetaAction { name: "Open", url: "https://x.com", icon: None }
33. `test_meta_action_with_icon` — includes `(meta-action-icon::globe-01-16)` → icon: Some("globe-01-16")
34. `test_multiple_meta_actions` — two triples → two MetaAction tokens at end
35. `test_meta_action_only` — `"(meta-action-name::X)(meta-action-url::Y)"` → empty after trim → only MetaAction token
36. `test_meta_action_removed_from_inline` — text remaining after extraction is parsed for inline tokens (no meta-action syntax in inline output)
37. `test_meta_action_name_with_spaces` — `"(meta-action-name::Open Task)(meta-action-url::U)"` → name: "Open Task"

**Meta-mdtree extraction (3 tests):**
38. `test_meta_mdtree` — `"text (meta-mdtree:: archive)"` → text token + MetaMdtree { directive: "archive" }
39. `test_meta_mdtree_no_space` — `"text (meta-mdtree::collapse)"` → directive: "collapse"
40. `test_multiple_meta_mdtree` — two directives → two MetaMdtree tokens

**Edge cases (4+ tests):**
41. `test_empty_input` — `""` → empty vec
42. `test_plain_text_only` — `"hello world"` → single Text { text: "hello world", decoration: "none" }
43. `test_trim_applied` — `"  [[Note]]  "` → after trim, produces ObsidianLink (no leading/trailing whitespace text tokens around the link)
44. `test_output_order` — mixed content with meta-actions → inline tokens first, then meta_action, then meta_mdtree

**Verification:** `cargo test` passes all tests (>=44 tests).

---

## Task 5 — Implement `adaptParseTokens` TypeScript adapter function

**Modify `packages/parser-native/ts/adapter.ts`:**

- Add import for `ParsedTextToken` from `@mdtree/core`.
- Export function `adaptParseTokens(json: string): ParsedTextToken[]`:
  ```typescript
  export function adaptParseTokens(json: string): ParsedTextToken[] {
    return JSON.parse(json) as ParsedTextToken[]
  }
  ```
- The JSON output from Rust already matches the TypeScript type structure because:
  - `#[serde(tag = "tokenType")]` produces `{ "tokenType": "obsidian_link", ... }`
  - `#[serde(skip_serializing_if = "Option::is_none")]` omits undefined fields
  - Field names use the correct casing via `#[serde(rename = "...")]`
  - `Image.alt` is always a `String` (never Option), so it is always serialized
- No null→undefined conversion needed here because optional fields are simply absent from the JSON when `None` (unlike the list scanner where `parent: null` must become `undefined`).

**Update `packages/parser-native/ts/index.ts`:**

- Update the re-export to include `adaptParseTokens`:
  ```typescript
  export { adaptFrontmatter, adaptScanResult, adaptParseTokens } from "./adapter.ts"
  ```

**Verification:** TypeScript type-checks without errors.

---

## Task 6 — Write TypeScript conformance tests

**Create `packages/parser-native/ts/__tests__/inline-tokens.test.ts`:**

- Import `parseTokens` and `parseVaultFile` from `@mdtree/core`.
- Import `adaptParseTokens` from `../adapter.ts`.
- Import `loadNativeParser` from `../index.ts`.
- Load WASM in `beforeAll` from `../../pkg/parser_native_bg.wasm`.
- Helper function:
  ```typescript
  function parseWithRust(text: string) {
    const json = handle.parse_tokens(text)
    return adaptParseTokens(json)
  }
  ```

**Fixture-derived conformance tests:**

Extract all unique `rawText` values from the integration fixtures by parsing each fixture file with `parseVaultFile` and collecting `page.file.lists.values[*].rawText`. For each unique rawText value, compare `parseWithRust(rawText)` against `parseTokens(rawText)` using deep equality.

- Also test frontmatter parent strings from fixtures (e.g., `"[[Root]]"` from `multi-page/index.md`).
- Discover fixture files dynamically (same pattern as `list-scanner.test.ts` using `findMdFiles`).

**Synthetic conformance tests (>=19 tests):**

1. Plain obsidian link: `"[[Note]]"`
2. Obsidian link with alias: `"[[Note|Display Name]]"`
3. Obsidian link with header: `"[[Note#Section]]"`
4. Obsidian link with header and alias: `"[[Note#Section|Alias]]"`
5. Obsidian link with folder path: `"[[folder/Note]]"`
6. Markdown link: `"[text](https://example.com)"`
7. Image: `"![screenshot](img.png)"`
8. Bare HTTP URL: `"see https://example.com/path for details"`
9. Bold text (two-token): `"**important** note"`
10. Italic text (two-token): `"*emphasized* word"`
11. Strikethrough (two-token): `"~~removed~~ text"`
12. Inline code (single-token): `` "`variable` name" ``
13. Meta-action triple with icon: `"task (meta-action-name::Open)(meta-action-url::https://x.com)(meta-action-icon::globe-01-16)"`
14. Meta-action without icon: `"link (meta-action-name::Open)(meta-action-url::https://x.com)"`
15. Meta-mdtree: `"item (meta-mdtree:: archive)"`
16. Mixed content: `"[[Page]] is great *and* has https://link.com"`
17. Empty string: `""`
18. Text only (no special tokens): `"just plain text"`
19. URL from todoist fixture: `"Buy milk https://app.todoist.com/app/task/task1 (meta-action-name::Open Task)(meta-action-url::https://app.todoist.com/app/task/task1)(meta-action-icon::globe-01-16)"`

Each test asserts deep equality between Rust and TS output. These tests are the ground truth — if the Rust output diverges from TS output, the Rust implementation is incorrect.

**Verification:** `bun test packages/parser-native/ts/__tests__/inline-tokens.test.ts` passes (requires prior `wasm-pack build`).
