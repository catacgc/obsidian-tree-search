# Spec Delta: rust-parser-04-inline-tokens

## ADDED Requirements

### Requirement: Obsidian Link Parsing

The Rust `parse_tokens` function SHALL correctly parse obsidian-style wikilinks and produce `ObsidianLinkToken` output structurally identical to the TypeScript `parseTokens` function.

#### Scenario: Simple obsidian link

- **Given** the input string `"[[Target Note]]"`
- **When** `parse_tokens` is called
- **Then** the output MUST contain exactly one token
- **And** that token MUST have `tokenType` equal to `"obsidian_link"`
- **And** `source` MUST be `"[[Target Note]]"`
- **And** `pageTarget` MUST be `"Target Note"`
- **And** `alias` MUST be absent (not serialized)
- **And** `headerName` MUST be absent (not serialized)

#### Scenario: Obsidian link with alias

- **Given** the input string `"[[Target|Display Name]]"`
- **When** `parse_tokens` is called
- **Then** the output MUST contain a token with `tokenType` `"obsidian_link"`
- **And** `pageTarget` MUST be `"Target"`
- **And** `alias` MUST be `"Display Name"`
- **And** `source` MUST be `"[[Target|Display Name]]"`

#### Scenario: Obsidian link with header reference

- **Given** the input string `"[[Page#Section]]"`
- **When** `parse_tokens` is called
- **Then** the output MUST contain a token with `tokenType` `"obsidian_link"`
- **And** `pageTarget` MUST be `"Page"`
- **And** `headerName` MUST be `"Section"`

#### Scenario: Obsidian link with header and alias

- **Given** the input string `"[[Page#Section|Alias]]"`
- **When** `parse_tokens` is called
- **Then** `pageTarget` MUST be `"Page"`, `headerName` MUST be `"Section"`, `alias` MUST be `"Alias"`

#### Scenario: Obsidian link with folder path (resolveReference)

- **Given** the input string `"[[folder/SubNote]]"`
- **When** `parse_tokens` is called
- **Then** `pageTarget` MUST be `"SubNote"` (the element at index 1 after splitting the fileName on `/`)
- **And** `source` MUST be `"[[folder/SubNote]]"`

#### Scenario: Obsidian link with deep folder path (resolveReference index 1)

- **Given** the input string `"[[a/b/Note]]"`
- **When** `parse_tokens` is called
- **Then** `pageTarget` MUST be `"b"` (split on `/` gives `["a", "b", "Note"]`, index 1 is `"b"` — matching the TypeScript `resolveReference` at `inline-tokens.ts:57`)

#### Scenario: Obsidian link surrounded by text

- **Given** the input string `"before [[Link]] after"`
- **When** `parse_tokens` is called
- **Then** the output MUST contain three tokens in order:
  1. `{ tokenType: "text", text: "before ", decoration: "none" }`
  2. `{ tokenType: "obsidian_link", source: "[[Link]]", pageTarget: "Link" }`
  3. `{ tokenType: "text", text: " after", decoration: "none" }`

#### Scenario: Unclosed obsidian link treated as plain text

- **Given** the input string `"[[Unclosed"`
- **When** `parse_tokens` is called
- **Then** the output MUST contain text token(s) including `"[["` as literal characters (no obsidian_link token produced)

---

### Requirement: Markdown Link and Image Parsing

The Rust `parse_tokens` function SHALL correctly parse standard markdown links and images.

#### Scenario: Standard markdown link

- **Given** the input string `"[click here](https://example.com)"`
- **When** `parse_tokens` is called
- **Then** the output MUST contain a token with `tokenType` `"link"`
- **And** `href` MUST be `"https://example.com"`
- **And** `content` MUST be `"click here"`

#### Scenario: Markdown image

- **Given** the input string `"![screenshot](assets/img.png)"`
- **When** `parse_tokens` is called
- **Then** the output MUST contain a token with `tokenType` `"image"`
- **And** `src` MUST be `"assets/img.png"`
- **And** `alt` MUST be `"screenshot"`

#### Scenario: Markdown image with empty alt text

- **Given** the input string `"![](assets/img.png)"`
- **When** `parse_tokens` is called
- **Then** the output MUST contain a token with `tokenType` `"image"`
- **And** `alt` MUST be `""` (empty string, NEVER absent/null — matching TS behavior at `inline-tokens.ts:124`)

#### Scenario: Bare HTTP URL converted to link

- **Given** the input string `"visit https://example.com/path for info"`
- **When** `parse_tokens` is called
- **Then** the output MUST contain a `"link"` token with `href` set to `"https://example.com/path"` and `content` set to the same URL
- **And** the preceding text MUST be captured as a text token

#### Scenario: URL inside markdown link syntax is NOT double-converted

- **Given** the input string `"[label](https://example.com)"`
- **When** `parse_tokens` is called
- **Then** only one `"link"` token MUST be produced (the URL is not additionally extracted as a bare URL)

#### Scenario: Obsidian embed is NOT an image

- **Given** the input string `"![[File]]"`
- **When** `parse_tokens` is called
- **Then** the output MUST contain a text token with `text` `"!"` and `decoration` `"none"`
- **And** an `obsidian_link` token with `source` `"[[File]]"` and `pageTarget` `"File"`
- **And** no `image` token SHALL be produced

---

### Requirement: Text Decoration Parsing (Two-Token Pattern)

The Rust `parse_tokens` function SHALL detect inline text decorations and produce tokens matching the exact TypeScript/markdown-it token structure. Bold, italic, and strikethrough MUST produce TWO tokens each (an empty-text opener token with the decoration name, followed by the content text with decoration "none"). Only inline code produces a SINGLE token with content.

#### Scenario: Bold text produces two tokens

- **Given** the input string `"**bold content**"`
- **When** `parse_tokens` is called
- **Then** the output MUST contain exactly TWO tokens:
  1. `{ tokenType: "text", text: "", decoration: "bold" }`
  2. `{ tokenType: "text", text: "bold content", decoration: "none" }`

#### Scenario: Italic text with asterisk produces two tokens

- **Given** the input string `"*italic*"`
- **When** `parse_tokens` is called
- **Then** the output MUST contain exactly TWO tokens:
  1. `{ tokenType: "text", text: "", decoration: "italic" }`
  2. `{ tokenType: "text", text: "italic", decoration: "none" }`

#### Scenario: Italic text with underscore produces two tokens

- **Given** the input string `"_italic_"`
- **When** `parse_tokens` is called
- **Then** the output MUST contain exactly TWO tokens:
  1. `{ tokenType: "text", text: "", decoration: "italic" }`
  2. `{ tokenType: "text", text: "italic", decoration: "none" }`

#### Scenario: Strikethrough text produces two tokens

- **Given** the input string `"~~struck~~"`
- **When** `parse_tokens` is called
- **Then** the output MUST contain exactly TWO tokens:
  1. `{ tokenType: "text", text: "", decoration: "strikethrough" }`
  2. `{ tokenType: "text", text: "struck", decoration: "none" }`

#### Scenario: Inline code produces single token (exception to two-token rule)

- **Given** the input string `` "`code_var`" ``
- **When** `parse_tokens` is called
- **Then** the output MUST contain exactly ONE token: `{ tokenType: "text", text: "code_var", decoration: "code" }`

#### Scenario: Code span prevents inner parsing

- **Given** the input string `` "`[[not a link]]`" ``
- **When** `parse_tokens` is called
- **Then** the output MUST contain a single text token with `decoration` `"code"` and `text` `"[[not a link]]"`
- **And** no `obsidian_link` token SHALL be produced

#### Scenario: Bold text with surrounding plain text

- **Given** the input string `"plain **bold** plain"`
- **When** `parse_tokens` is called
- **Then** the output MUST contain tokens in order:
  1. `{ tokenType: "text", text: "plain ", decoration: "none" }`
  2. `{ tokenType: "text", text: "", decoration: "bold" }`
  3. `{ tokenType: "text", text: "bold", decoration: "none" }`
  4. `{ tokenType: "text", text: " plain", decoration: "none" }`

#### Scenario: Plain text with no decoration

- **Given** the input string `"just plain text"`
- **When** `parse_tokens` is called
- **Then** the output MUST contain exactly one token: `{ tokenType: "text", text: "just plain text", decoration: "none" }`

#### Scenario: Unclosed bold treated as plain text

- **Given** the input string `"**unclosed"`
- **When** `parse_tokens` is called
- **Then** no token with `decoration` `"bold"` SHALL be produced
- **And** the output MUST contain text token(s) including `"**"` as literal characters

---

### Requirement: Meta-Action and Meta-Mdtree Extraction

The Rust `parse_tokens` function SHALL extract meta-action triples and meta-mdtree directives from the input, remove them before inline parsing, and append them as tokens at the end of the output array.

#### Scenario: Meta-action triple extraction

- **Given** the input string `"task text (meta-action-name::Open)(meta-action-url::https://x.com)"`
- **When** `parse_tokens` is called
- **Then** the last token in the output MUST be `{ tokenType: "meta_action", name: "Open", url: "https://x.com" }` with `icon` absent
- **And** the preceding token(s) MUST represent `"task text"` parsed for inline content (no meta-action syntax present)

#### Scenario: Meta-action triple with icon

- **Given** the input string `"link (meta-action-name::Open)(meta-action-url::https://x.com)(meta-action-icon::globe-01-16)"`
- **When** `parse_tokens` is called
- **Then** the meta_action token MUST have `icon` equal to `"globe-01-16"`

#### Scenario: Multiple meta-action triples

- **Given** input containing two separate meta-action triples
- **When** `parse_tokens` is called
- **Then** two `meta_action` tokens MUST appear at the end of the output array

#### Scenario: Meta-mdtree directive extraction

- **Given** the input string `"My item (meta-mdtree:: archive)"`
- **When** `parse_tokens` is called
- **Then** the output MUST end with `{ tokenType: "meta_mdtree", directive: "archive" }`
- **And** the preceding token(s) MUST represent `"My item"` without the meta-mdtree syntax

#### Scenario: Meta-action and meta-mdtree together

- **Given** input containing both a meta-action triple and a meta-mdtree directive
- **When** `parse_tokens` is called
- **Then** meta_action tokens MUST appear before meta_mdtree tokens in the output (matching the order: inline tokens, then meta-actions, then meta-mdtree)

#### Scenario: Only meta-action content (no other text)

- **Given** the input string `"(meta-action-name::X)(meta-action-url::Y)"`
- **When** `parse_tokens` is called
- **Then** the output MUST contain only a `meta_action` token (trimmed text is empty, so no inline tokens)

---

### Requirement: Output Token Ordering

The Rust `parse_tokens` function SHALL produce output tokens in the same order as the TypeScript implementation.

#### Scenario: Output order is inline tokens then meta tokens

- **Given** an input string containing both inline content (links, text) AND meta-action/meta-mdtree annotations
- **When** `parse_tokens` is called
- **Then** the output array MUST contain inline tokens (in document order) first, followed by all meta_action tokens, followed by all meta_mdtree tokens

---

### Requirement: Input Trimming Before Inline Parsing

The Rust `parse_tokens` function SHALL trim whitespace from the cleaned input (after meta extraction) before performing inline parsing, matching the TypeScript behavior at line 153.

#### Scenario: Leading and trailing whitespace trimmed

- **Given** the input string `"  [[Note]]  "`
- **When** `parse_tokens` is called
- **Then** the output MUST be identical to calling `parse_tokens("[[Note]]")` (no whitespace text tokens around the link)

---

### Requirement: WASM Export for Inline Token Parsing

The `parse_tokens` function SHALL be exported via `wasm_bindgen` and callable from JavaScript.

#### Scenario: Calling parse_tokens from JavaScript via WASM

- **Given** the WASM module is loaded and instantiated
- **When** `parse_tokens(text)` is called with any string
- **Then** it MUST return a valid JSON string
- **And** the JSON MUST be a JSON array of token objects

#### Scenario: Each token has a tokenType field

- **Given** any non-empty input to `parse_tokens`
- **When** the JSON result is parsed
- **Then** every element in the array MUST have a `tokenType` field with a value from: `"text"`, `"obsidian_link"`, `"link"`, `"image"`, `"meta_action"`, `"meta_mdtree"`

#### Scenario: Optional fields are omitted when absent

- **Given** a simple obsidian link `"[[Note]]"` (no alias, no header)
- **When** `parse_tokens` is called and the JSON result is parsed
- **Then** the token object MUST NOT contain `alias` or `headerName` keys (they are omitted, not set to null)

---

### Requirement: TypeScript Adapter for Inline Tokens

The `packages/parser-native/ts/adapter.ts` module SHALL export a function to deserialize WASM inline token output into the `@mdtree/core` `ParsedTextToken[]` type.

#### Scenario: Adapting valid token JSON

- **Given** a JSON string returned by the WASM `parse_tokens` function
- **When** `adaptParseTokens(json)` is called
- **Then** it MUST return a `ParsedTextToken[]` array

#### Scenario: Adapted output matches TypeScript parseTokens output

- **Given** any text string used as `rawText` in the existing integration test fixtures
- **When** the string is parsed by both the Rust parser (via WASM + adapter) and the TS `parseTokens` function
- **Then** the adapted Rust output MUST deep-equal the TS output

---

### Requirement: Conformance with TypeScript Parser

The Rust inline token parser MUST produce structurally identical output to the TypeScript `parseTokens` function for all inputs derived from the existing test fixtures.

#### Scenario: Conformance on fixture-derived rawText values

- **Given** all unique `rawText` values extracted from the integration fixture files by parsing with `parseVaultFile`
- **When** both the Rust parser and TS `parseTokens` are called on each value
- **Then** the outputs MUST be identical (deep equality on the `ParsedTextToken[]` arrays)

#### Scenario: Conformance on frontmatter parent strings

- **Given** frontmatter parent strings from fixtures (e.g., `"[[Root]]"` from `multi-page/index.md`)
- **When** both parsers process each string
- **Then** the outputs MUST be identical

#### Scenario: Conformance on synthetic edge cases

- **Given** synthetic inputs including: empty string, plain text, obsidian links with all variations (alias, header, folder), markdown links, images, bare HTTP URLs, text decorations matching the two-token pattern (bold/italic/strikethrough opener+content) and single-token pattern (code), meta-action triples (with/without icon), meta-mdtree directives, and mixed content combining multiple token types
- **When** both parsers process each input
- **Then** the outputs MUST be identical for every case
