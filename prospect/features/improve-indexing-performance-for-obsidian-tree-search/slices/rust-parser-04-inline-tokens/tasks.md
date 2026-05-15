# Tasks: rust-parser-04-inline-tokens

## Task 1 — Create `inline_tokens.rs` with serde output types and declare module

**Create `packages/parser-native/src/inline_tokens.rs`:**

- Define serde-serializable output types using tagged enums to mirror the `ParsedTextToken` union type. Use `#[serde(tag = "tokenType")]` for the enum and rename fields as needed. Use `#[serde(skip_serializing_if = "Option::is_none")]` for optional fields (`alias`, `headerName`, `icon`, `alt`, `content`):

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
          #[serde(skip_serializing_if = "Option::is_none")]
          alt: Option<String>,
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

**Step 1: Meta-action triple extraction.**

- Use the regex pattern `\(meta-action-name::([^)]*)\)\(meta-action-url::([^)]*)\)(?:\(meta-action-icon::([^)]*)\))?` (matching TS `META_ACTION_TRIPLE_RE` at line 133-134).
- Iterate over all matches in `input`. For each match:
  - Extract `name` (group 1), `url` (group 2), `icon` (group 3, optional).
  - Collect into a `Vec<ParsedToken::MetaAction>`.
  - Replace the matched substring with empty string.
- The replacement must handle overlapping/adjacent matches correctly (global replace).

**Step 2: Meta-mdtree directive extraction.**

- Use the regex pattern `\(meta-mdtree::\s*(\w+)\)` (matching TS `META_MDTREE_RE` at line 135).
- Iterate over all matches in the already-cleaned string. For each match:
  - Extract `directive` (group 1).
  - Collect into a `Vec<ParsedToken::MetaMdtree>`.
  - Replace the matched substring with empty string.

**Step 3: Trim the cleaned string.**

- `let cleaned = cleaned.trim();`
- If `cleaned` is empty, return the meta tokens directly (no inline parsing needed).

**Step 4: Inline parsing state machine.**

Implement a character-by-character state machine on `cleaned` that detects (in priority order):

1. **Obsidian links** (`[[`): When `[[` is encountered, scan forward for `]]`. Extract the content between them. Split on `|` to separate `[target_with_header, alias]`. Split the target portion on `#` to get `[fileName, headerName]`. Apply `resolve_reference(fileName)`: if fileName contains `/`, return `fileName.split("/")[1]` (the second segment at index 1, matching the TS implementation at `inline-tokens.ts:57`). Produce `ParsedToken::ObsidianLink`.

2. **Images** (`![`): When `![` is encountered (and NOT part of `![[`), scan for `]` to get alt text, then expect `(` and scan for `)` to get src. Produce `ParsedToken::Image`.

3. **Markdown links** (`[` not preceded by `!`): When `[` is encountered, scan for `]` to get content text, then expect `(` and scan for `)` to get href. Produce `ParsedToken::Link`.

4. **HTTP URLs**: When `http://` or `https://` is encountered as a word boundary (preceded by start-of-string or whitespace, and NOT preceded by `[` or `<`), scan forward consuming non-whitespace characters until a whitespace or end-of-string (stopping also before `)`, `]`, `>`, `,` if they appear to terminate the URL — matching the TS regex `/(^|\s)(https?:\/\/[^\s\])}>,]+)/gm`). The URL is then treated as a markdown link `[url](url)`, producing `ParsedToken::Link { href: url, content: Some(url) }`.

5. **Bold** (`**`): When `**` is encountered, scan for the next `**`. The enclosed text becomes `ParsedToken::Text { text, decoration: "bold" }`. If no closing `**` is found, treat the `**` as plain text.

6. **Italic** (`*` or `_` single): When a single `*` or `_` is encountered (not part of `**`), scan for the matching closer. Produce `ParsedToken::Text { text, decoration: "italic" }`.

7. **Strikethrough** (`~~`): When `~~` is encountered, scan for the next `~~`. Produce `ParsedToken::Text { text, decoration: "strikethrough" }`.

8. **Inline code** (`` ` ``): When a backtick is encountered, scan for the next backtick. Content within backticks is NOT parsed for inner syntax (links, decorations, etc.). Produce `ParsedToken::Text { text, decoration: "code" }`.

9. **Plain text**: Any characters not consumed by the above rules accumulate into a plain text buffer. When a special token is encountered (or end of input), flush the buffer as `ParsedToken::Text { text, decoration: "none" }`.

**Important behaviors matching the TS implementation:**

- The `inlineHttpLinkPlugin` in TS transforms URLs in the source BEFORE markdown-it parses. It replaces `(^|\s)(https://...)` with `$1[$2]($2)` — so URLs become markdown links. The Rust parser should produce the same output: a `Link` token with both `href` and `content` set to the URL. The space character preceding the URL should remain as part of a preceding text token (if any).
- The TS `parseTokenList` skips tokens it doesn't recognize (the `return parseTokenList(tokens.slice(1))` fallthrough at line 130). This means `strong_close`, `em_close`, `s_close`, `link_close` tokens are silently consumed. The Rust state machine should similarly not produce output for closing markers.
- The TS code produces text tokens for `softbreak` with `{ text: "", decoration: "none" }`. In practice, this happens when markdown-it encounters a newline in the inline content. Since `parseTokens` receives single-line `rawText` strings, softbreaks are rare but the Rust parser should handle newlines in input by producing an empty text token if a bare `\n` is encountered.
- The `resolveReference` function at `inline-tokens.ts:56-59`: `if (ref.includes("/")) return ref.split("/")[1]` — this takes the element at index 1 after splitting on `/`. For `"folder/Note"` this returns `"Note"`. For `"a/b/Note"` this returns `"b"` (NOT `"Note"`). The Rust implementation must replicate this exact behavior.

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
- Update `loadNativeParser` to include `parse_tokens` in the returned handle.

**Verification:** `wasm-pack build --target web --out-dir pkg` succeeds; TypeScript type-checks.

---

## Task 4 — Write Rust unit tests (>=40 tests)

Add `#[cfg(test)] mod tests` block at the bottom of `inline_tokens.rs`:

**Obsidian link parsing (10 tests):**
1. `test_simple_obsidian_link` — `"[[Note]]"` → 1 token: ObsidianLink with source="[[Note]]", pageTarget="Note", alias=None, headerName=None
2. `test_obsidian_link_with_alias` — `"[[Note|Display]]"` → pageTarget="Note", alias=Some("Display")
3. `test_obsidian_link_with_header` — `"[[Note#Section]]"` → pageTarget="Note", headerName=Some("Section")
4. `test_obsidian_link_with_header_and_alias` — `"[[Note#Section|Alias]]"` → all three fields
5. `test_obsidian_link_with_folder` — `"[[folder/Note]]"` → pageTarget="Note" (resolveReference: split("/")[1])
6. `test_obsidian_link_deep_folder` — `"[[a/b/Note]]"` → pageTarget="b" (split("/")[1] takes index 1, NOT last segment)
7. `test_obsidian_link_text_around` — `"before [[Link]] after"` → 3 tokens: text("before "), ObsidianLink, text(" after")
8. `test_multiple_obsidian_links` — `"[[A]] and [[B]]"` → text, ObsidianLink(A), text, ObsidianLink(B)
9. `test_unclosed_obsidian_link` — `"[[Unclosed"` → treated as plain text
10. `test_empty_obsidian_link` — `"[[]]"` → ObsidianLink with pageTarget=""

**Markdown link and image parsing (6 tests):**
11. `test_markdown_link` — `"[text](http://example.com)"` → Link { href, content: Some("text") }
12. `test_markdown_link_empty_text` — `"[](http://x.com)"` → Link { href, content: Some("") }
13. `test_image` — `"![alt text](image.png)"` → Image { src: "image.png", alt: Some("alt text") }
14. `test_image_no_alt` — `"![](image.png)"` → Image { src: "image.png", alt: Some("") }
15. `test_obsidian_embed_not_image` — `"![[File]]"` → ObsidianLink with source `"[[File]]"` (the `!` is consumed as text or skipped, and `[[File]]` is parsed as obsidian link — matching TS behavior where the obsidian_link rule in markdown-it only matches `[[...]]` after consuming any prefix)
16. `test_link_with_special_chars` — `"[docs](https://example.com/path?q=1&r=2)"` → correct href preserved

**HTTP URL detection (5 tests):**
17. `test_bare_https_url` — `"https://example.com"` → Link { href: url, content: Some(url) }
18. `test_bare_http_url` — `"http://example.com"` → Link token
19. `test_url_after_text` — `"see https://x.com"` → text("see "), Link
20. `test_url_not_in_brackets` — `"[https://x.com](https://x.com)"` → single Link (already inside markdown link syntax, URL not double-detected)
21. `test_url_terminated_at_special_chars` — `"https://x.com/path) more"` → Link href stops before `)`, then text(" more")

**Text decoration (8 tests):**
22. `test_bold` — `"**bold text**"` → Text { text: "bold text", decoration: "bold" }
23. `test_italic_star` — `"*italic*"` → decoration: "italic"
24. `test_italic_underscore` — `"_italic_"` → decoration: "italic"
25. `test_strikethrough` — `"~~struck~~"` → decoration: "strikethrough"
26. `test_inline_code` — `` "`code here`" `` → decoration: "code"
27. `test_mixed_text_and_bold` — `"plain **bold** plain"` → text(none), text(bold), text(none)
28. `test_unclosed_bold` — `"**unclosed"` → treated as plain text
29. `test_code_preserves_special` — `` "`[[not a link]]`" `` → decoration: "code", text: "[[not a link]]", no obsidian link token

**Meta-action extraction (6 tests):**
30. `test_meta_action_triple` — `"text (meta-action-name::Open)(meta-action-url::https://x.com)"` → text token + MetaAction { name: "Open", url: "https://x.com", icon: None }
31. `test_meta_action_with_icon` — includes `(meta-action-icon::globe-01-16)` → icon: Some("globe-01-16")
32. `test_multiple_meta_actions` — two triples → two MetaAction tokens at end
33. `test_meta_action_only` — `"(meta-action-name::X)(meta-action-url::Y)"` → empty after trim → only MetaAction token
34. `test_meta_action_removed_from_inline` — text remaining after extraction is parsed for inline tokens (no meta-action syntax in inline output)
35. `test_meta_action_name_with_spaces` — `"(meta-action-name::Open Task)(meta-action-url::U)"` → name: "Open Task"

**Meta-mdtree extraction (3 tests):**
36. `test_meta_mdtree` — `"text (meta-mdtree:: archive)"` → text token + MetaMdtree { directive: "archive" }
37. `test_meta_mdtree_no_space` — `"text (meta-mdtree::collapse)"` → directive: "collapse"
38. `test_multiple_meta_mdtree` — two directives → two MetaMdtree tokens

**Edge cases (4+ tests):**
39. `test_empty_input` — `""` → empty vec
40. `test_plain_text_only` — `"hello world"` → single Text { text: "hello world", decoration: "none" }
41. `test_trim_applied` — `"  [[Note]]  "` → after trim, produces ObsidianLink (no leading/trailing whitespace text tokens)
42. `test_output_order` — mixed content with meta-actions → inline tokens first, then meta_action, then meta_mdtree

**Verification:** `cargo test` passes all tests (>=42 tests).

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

**Synthetic conformance tests (>=15 tests):**

1. Plain obsidian link: `"[[Note]]"`
2. Obsidian link with alias: `"[[Note|Display Name]]"`
3. Obsidian link with header: `"[[Note#Section]]"`
4. Obsidian link with header and alias: `"[[Note#Section|Alias]]"`
5. Obsidian link with folder path: `"[[folder/Note]]"`
6. Markdown link: `"[text](https://example.com)"`
7. Image: `"![screenshot](img.png)"`
8. Bare HTTP URL: `"see https://example.com/path for details"`
9. Bold text: `"**important** note"`
10. Italic text: `"*emphasized* word"`
11. Strikethrough: `"~~removed~~ text"`
12. Inline code: `` "`variable` name" ``
13. Meta-action triple with icon: `"task (meta-action-name::Open)(meta-action-url::https://x.com)(meta-action-icon::globe-01-16)"`
14. Meta-action without icon: `"link (meta-action-name::Open)(meta-action-url::https://x.com)"`
15. Meta-mdtree: `"item (meta-mdtree:: archive)"`
16. Mixed content: `"[[Page]] is great *and* has https://link.com"`
17. Empty string: `""`
18. Text only (no special tokens): `"just plain text"`
19. URL from todoist fixture: `"Buy milk https://app.todoist.com/app/task/task1 (meta-action-name::Open Task)(meta-action-url::https://app.todoist.com/app/task/task1)(meta-action-icon::globe-01-16)"`

Each test asserts deep equality between Rust and TS output.

**Verification:** `bun test packages/parser-native/ts/__tests__/inline-tokens.test.ts` passes (requires prior `wasm-pack build`).
