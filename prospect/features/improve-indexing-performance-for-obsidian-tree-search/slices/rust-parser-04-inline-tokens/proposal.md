# Proposal: rust-parser-04-inline-tokens

## Problem

The `parseTokens` function in `packages/core/src/parser/inline-tokens.ts` is the most frequently called parsing function in the indexing pipeline. It is invoked once per list item (for `rawText`) via `createNodeFromText` at `indexer.ts:53`, once per frontmatter parent string at `indexer.ts:238`, and once per canvas text line at `text-lines.ts:82`. For a vault with M total list items, this means M calls to `markdown-it`'s inline parser — each instantiating token chains and running multiple plugins. On mobile, where the JavaScript engine is significantly slower, this is the single largest contributor to per-item indexing latency.

The function currently:
1. Extracts meta-action triples via regex and removes them from the input
2. Extracts meta-mdtree directives via regex and removes them from the input
3. Trims the cleaned string and passes it to `markdown-it.parseInline()`
4. Recursively traverses the token tree to produce `ParsedTextToken[]` (obsidian links, markdown links, images, HTTP URLs, text decorations)
5. Appends the extracted meta-action and meta-mdtree tokens

Moving this to Rust as a hand-written state machine avoids pulling a full markdown parser into WASM while covering the exact subset of inline syntax this codebase uses.

## Outcome

A Rust implementation of `parseTokens` compiled to WASM that produces structurally identical `ParsedTextToken[]` output to the TypeScript implementation. The function is exported via `#[wasm_bindgen]` as `parse_tokens` and a TypeScript adapter deserializes the JSON output. This module will be called both standalone (for canvas/frontmatter-parent paths) and batch-internal (pre-computing tokens for all list items in slices 05/06).

## Changes

- New Rust module `packages/parser-native/src/inline_tokens.rs` implementing `parse_tokens`
- Serde-serializable output types mirroring all `ParsedTextToken` variants (`TextToken`, `ObsidianLinkToken`, `LinkToken`, `ImageToken`, `MetaActionToken`, `MetaMdtreeToken`)
- Hand-written state machine for: obsidian `[[link|alias]]` with header syntax, standard markdown `[text](url)`, images `![alt](src)`, HTTP/HTTPS URL detection, text decorations (bold `**`, italic `*`/`_`, strikethrough `~~`, inline code `` ` ``), and softbreak
- Meta-action triple extraction: `(meta-action-name::VAL)(meta-action-url::VAL)` with optional `(meta-action-icon::VAL)`
- Meta-mdtree directive extraction: `(meta-mdtree:: WORD)`
- `resolveReference` logic: if link target contains `/`, return the second segment (`split("/")[1]`) — matching the TS implementation
- `#[wasm_bindgen]` export `parse_tokens` in `lib.rs` returning JSON
- TypeScript adapter function `adaptParseTokens` in `packages/parser-native/ts/adapter.ts`
- Extension of `NativeParserHandle` and `WasmExports` types to include `parse_tokens`
- Rust unit tests (>=40) and TypeScript conformance tests

## In-Scope

- Meta-action triple extraction and removal from input text before inline parsing
- Meta-mdtree directive extraction and removal from input text before inline parsing
- Obsidian link parsing: `[[target]]`, `[[target|alias]]`, `[[target#header]]`, `[[target#header|alias]]`, `[[folder/target]]` (resolveReference returns `split("/")[1]`)
- Standard markdown link parsing: `[text](url)` producing `LinkToken`
- Image parsing: `![alt](src)` producing `ImageToken`
- HTTP/HTTPS URL detection: bare URLs (`https://...`) converted to `LinkToken` (matching the `inlineHttpLinkPlugin` behavior that wraps them as `[url](url)`)
- Text decoration detection: `**bold**`, `*italic*`, `_italic_`, `~~strikethrough~~`, `` `code` ``
- Plain text segments between special tokens (producing `TextToken` with `decoration: "none"`)
- Softbreak handling (newlines within inline content → `TextToken` with empty text and `decoration: "none"`)
- The `.trim()` applied to cleaned text before parsing (matching TS line 153)
- Output ordering: inline tokens first (in document order), then meta-action tokens, then meta-mdtree tokens (matching TS line 154)

## Non-Goals

- Full markdown block parsing (only inline/span-level elements are handled)
- Modifications to `@mdtree/core` types (the `ParsedTextToken` union type is unchanged)
- Batch API or integration with `parseVaultFile` — that is slice 05
- Core integration or `ParserProvider` wiring — that is slice 06
- Handling of `link_close` or `strong_close`/`em_close`/`s_close` tokens explicitly (only open markers produce decoration tokens, matching TS behavior where close tokens are skipped by the `parseTokenList` fallthrough)
- Nested emphasis resolution (e.g., `***bold italic***`) — the state machine handles basic non-nested cases; markdown-it edge cases with complex nesting are a known divergence risk documented in the design

## Acceptance Criteria

1. `packages/parser-native/src/inline_tokens.rs` exists with a public `parse_tokens` function
2. `cargo test` passes all Rust unit tests for the inline tokens module (>=40 tests)
3. Obsidian links: `[[Target]]` produces `{ tokenType: "obsidian_link", source: "[[Target]]", pageTarget: "Target" }`
4. Obsidian links with alias: `[[Target|Alias]]` produces `{ ..., pageTarget: "Target", alias: "Alias" }`
5. Obsidian links with header: `[[Target#Section]]` produces `{ ..., pageTarget: "Target", headerName: "Section" }`
6. Obsidian links with header and alias: `[[Target#Section|Alias]]` produces all three sub-fields
7. Obsidian links with folder path: `[[folder/Target]]` → `pageTarget: "Target"` (resolveReference returns `split("/")[1]`)
8. Markdown links: `[text](url)` produces `{ tokenType: "link", href: "url", content: "text" }`
9. Images: `![alt](src)` produces `{ tokenType: "image", src: "src", alt: "alt" }`
10. HTTP URLs: bare `https://example.com` produces `{ tokenType: "link", href: "https://example.com", content: "https://example.com" }`
11. Text decorations: `**bold**` → decoration "bold"; `*italic*` / `_italic_` → "italic"; `~~strike~~` → "strikethrough"; `` `code` `` → "code"
12. Plain text: undecorated text produces `{ tokenType: "text", text: "...", decoration: "none" }`
13. Meta-action triples: `(meta-action-name::N)(meta-action-url::U)` extracts to `{ tokenType: "meta_action", name: "N", url: "U" }` with optional `icon` field
14. Meta-mdtree directives: `(meta-mdtree:: archive)` extracts to `{ tokenType: "meta_mdtree", directive: "archive" }`
15. Meta-actions and meta-mdtree are removed from the input before inline parsing and appended after inline tokens in the output
16. Input is `.trim()`-ed after meta extraction, before inline parsing
17. Output token order: inline tokens in document order, then meta-action tokens, then meta-mdtree tokens
18. `#[wasm_bindgen]` export `parse_tokens(text)` returns valid JSON array
19. TypeScript adapter `adaptParseTokens` in `adapter.ts` converts JSON to `ParsedTextToken[]`
20. `NativeParserHandle` and `WasmExports` types are extended with `parse_tokens`
21. Conformance tests compare Rust vs TS output on all `rawText` values from the 8 integration fixture files
22. Conformance tests include synthetic cases covering: plain obsidian links, links with alias/header/folder, markdown links, images, HTTP URLs, bold/italic/strikethrough/code decorations, meta-action triples (with and without icon), meta-mdtree, mixed content (link + text + meta-action), empty string input, text-only input (no special tokens)
23. `undefined` fields in `ObsidianLinkToken` (`alias`, `headerName`) and `ImageToken` (`alt`) and `MetaActionToken` (`icon`) are omitted from JSON (not serialized as `null`)

## Feature Mapping

- **Source feature**: `improve-indexing-performance-for-obsidian-tree-search`
- **Slice item**: `rust-parser-04-inline-tokens`
