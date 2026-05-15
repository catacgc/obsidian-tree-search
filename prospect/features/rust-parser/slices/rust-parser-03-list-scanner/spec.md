# Spec: rust-parser-03-list-scanner

## ADDED Requirements

### Requirement: Rust list scanner SHALL produce structurally identical output to TypeScript scanMarkdown

The Rust `scan_markdown` function in `packages/parser-native/src/list_scanner.rs` SHALL accept raw markdown content, a file path, a frontmatter body-start byte offset, and an archive tag string. It SHALL return a JSON-serialized structure containing `lists` (array of DvList-equivalent objects) and `headers` (array of HeadingCache-equivalent objects) that are structurally identical to the output of the TypeScript `scanMarkdown` function for the same inputs.

#### Scenario: Basic header detection
- Given markdown content `"# Alpha\n## Beta\n### Gamma"`
- When `scan_markdown` is called with `frontmatter_body_start=0` and `archive_tag="archive"`
- Then the result SHALL contain 3 headers with headings `["Alpha", "Beta", "Gamma"]` and levels `[1, 2, 3]`

#### Scenario: Header position recording
- Given markdown content `"# First\n\n## Second"`
- When `scan_markdown` is called
- Then the first header SHALL have `position.start.line=0` and the second header SHALL have `position.start.line=2`

#### Scenario: List item with obsidian link is kept
- Given markdown content `"- [[Note]] is great"`
- When `scan_markdown` is called
- Then the result SHALL contain 1 list item with `text="[[Note]] is great"` and `rawText="[[Note]] is great"`

#### Scenario: Pure prose list items are skipped
- Given markdown content `"- just some text\n- more prose"`
- When `scan_markdown` is called
- Then the result SHALL contain 0 list items

#### Scenario: Items with http URLs are kept
- Given markdown content `"- https://example.com"`
- When `scan_markdown` is called
- Then the result SHALL contain 1 list item

#### Scenario: Items with inline tags are kept and tags extracted
- Given markdown content `"- buy milk #todo"`
- When `scan_markdown` is called
- Then the result SHALL contain 1 list item with `tags` containing `"#todo"`

#### Scenario: Multiple inline tags extracted
- Given markdown content `"- [[link]] #foo #bar/baz"`
- When `scan_markdown` is called
- Then the list item's `tags` SHALL equal `["#foo", "#bar/baz"]`

#### Scenario: Task detection with obsidian link
- Given markdown content `"- [ ] review [[Note]]"`
- When `scan_markdown` is called
- Then the result SHALL contain 1 list item with `task=true`, `completed=false`, and `text="review [[Note]]"`

#### Scenario: Completed task detection (lowercase x)
- Given markdown content `"- [x] [[Done]]"`
- When `scan_markdown` is called
- Then the result SHALL contain 1 list item with `task=true` and `completed=true`

#### Scenario: Completed task detection (uppercase X)
- Given markdown content `"- [X] [[Also done]]"`
- When `scan_markdown` is called
- Then the result SHALL contain 1 list item with `task=true` and `completed=true`

#### Scenario: Task prefix stripped from text
- Given markdown content `"- [ ] do [[Something]]"`
- When `scan_markdown` is called
- Then the list item's `text` SHALL be `"do [[Something]]"`

#### Scenario: Pure prose task items are skipped
- Given markdown content `"- [ ] plain task text"`
- When `scan_markdown` is called
- Then the result SHALL contain 0 list items

#### Scenario: Star and plus bullet prefixes
- Given markdown content `"* [[A]]\n+ [[B]]"`
- When `scan_markdown` is called
- Then the result SHALL contain 2 list items

#### Scenario: Numbered list items
- Given markdown content `"1. [[Item]]"`
- When `scan_markdown` is called
- Then the result SHALL contain 1 list item

### Requirement: Rust list scanner SHALL correctly wire parent-child relationships via indent tracking

The Rust `scan_markdown` function SHALL maintain an indent stack to determine parent-child relationships between list items. Each item's `parent` field SHALL contain the line number of its logical parent item based on indentation, or be absent/null for top-level items. The `children` array SHALL be populated in a post-pass to contain direct child items.

#### Scenario: Nested items have correct parent wiring
- Given markdown content `"- [[Parent]]\n  - [[Child]]"`
- When `scan_markdown` is called
- Then the child item's `parent` field SHALL equal the parent item's `line` value

#### Scenario: Children post-pass wiring
- Given markdown content `"- [[Parent]]\n  - [[Child A]]\n  - [[Child B]]"`
- When `scan_markdown` is called
- Then the parent item's `children` array SHALL contain 2 items with texts `"[[Child A]]"` and `"[[Child B]]"`

#### Scenario: Deep nesting
- Given markdown content `"- [[A]]\n  - [[B]]\n    - [[C]]"`
- When `scan_markdown` is called
- Then item B's parent SHALL be item A's line, and item C's parent SHALL be item B's line

#### Scenario: Sibling items have no parent
- Given markdown content `"- [[A]]\n- [[B]]"`
- When `scan_markdown` is called
- Then both items SHALL have `parent` absent/undefined

#### Scenario: De-dent resets parent correctly
- Given markdown content `"- [[A]]\n  - [[B]]\n- [[C]]"`
- When `scan_markdown` is called
- Then item C SHALL have `parent` absent/undefined

#### Scenario: Indent stack resets on new header
- Given markdown content `"- [[Pre]]\n  - [[Nested]]\n# New\n- [[Post]]"`
- When `scan_markdown` is called
- Then the item with text `"[[Post]]"` SHALL have `parent` absent/undefined

### Requirement: Rust list scanner SHALL track section subpaths from headers

The Rust `scan_markdown` function SHALL maintain a current section subpath that is updated each time a header is encountered. List items SHALL have their `section.subpath` field set to `#HeaderText` for the most recently encountered header, or `""` if no header has been encountered yet.

#### Scenario: Section subpath set from header
- Given markdown content `"# Setup\n\n- [[Config]]"`
- When `scan_markdown` is called
- Then the list item SHALL have `section.subpath` equal to `"#Setup"`

#### Scenario: Section updates on new header
- Given markdown content `"# First\n\n- [[A]]\n\n# Second\n\n- [[B]]"`
- When `scan_markdown` is called
- Then the first item SHALL have `section.subpath="#First"` and the second SHALL have `section.subpath="#Second"`

#### Scenario: Empty subpath before any header
- Given markdown content `"- [[A]]"`
- When `scan_markdown` is called
- Then the list item SHALL have `section.subpath` equal to `""`

### Requirement: Rust list scanner SHALL strip meta-action and meta-mdtree syntax from text while preserving rawText

The Rust `scan_markdown` function SHALL strip `(meta-action-*::...)` and `(meta-mdtree:: \w+)` patterns from the `text` field while preserving the original (post-task-strip) content in the `rawText` field. Items where `rawText != text` (meaning meta-syntax was stripped) MUST NOT be skipped by the shouldSkip logic even if the resulting `text` alone would be pure prose. Items where `text` is empty after stripping MUST be skipped.

#### Scenario: Meta-action stripped from text, preserved in rawText
- Given markdown content `"- https://example.com (meta-action-name::Open)(meta-action-url::https://x.com)(meta-action-icon::globe-01-16)"`
- When `scan_markdown` is called
- Then the list item's `text` SHALL be `"https://example.com"` and `rawText` SHALL contain `"meta-action-name::Open"`

#### Scenario: Meta-action-only items (empty text after strip) are skipped
- Given markdown content `"- (meta-action-name::X)(meta-action-url::https://x.com)"`
- When `scan_markdown` is called
- Then the result SHALL contain 0 list items

#### Scenario: Plain text item with meta-action is kept
- Given markdown content `"- Buy milk (meta-action-name::Open Task)(meta-action-url::https://todoist.com/task/1)(meta-action-icon::globe-01-16)"`
- When `scan_markdown` is called
- Then the result SHALL contain 1 list item with `text="Buy milk"` and `rawText` containing `"meta-action-name::Open Task"`

#### Scenario: Meta-mdtree stripped from text
- Given markdown content `"- My archived item (meta-mdtree:: archive)"`
- When `scan_markdown` is called
- Then the list item's `text` SHALL be `"My archived item"` and `rawText` SHALL contain `"meta-mdtree:: archive"`

#### Scenario: Task item rawText is post-task pre-meta
- Given markdown content `"- [ ] do [[thing]] (meta-action-name::Open)(meta-action-url::https://x.com)"`
- When `scan_markdown` is called
- Then `rawText` SHALL be `"do [[thing]] (meta-action-name::Open)(meta-action-url::https://x.com)"` and `text` SHALL be `"do [[thing]]"`

### Requirement: Rust list scanner SHALL filter items containing archive tag

The Rust `scan_markdown` function SHALL skip list items whose text contains the configured archive tag (prefixed with `#`).

#### Scenario: Archive tag filtering
- Given markdown content `"- [[Note]] #archive"` and `archive_tag="archive"`
- When `scan_markdown` is called
- Then the result SHALL contain 0 list items

#### Scenario: Different tag not filtered
- Given markdown content `"- [[Note]] #todo"` and `archive_tag="archive"`
- When `scan_markdown` is called
- Then the result SHALL contain 1 list item

### Requirement: Rust list scanner SHALL correctly handle frontmatter body-start offset

The Rust `scan_markdown` function SHALL calculate the body-start line number from the byte offset (matching the TypeScript character-counting logic) and skip all lines before that line number.

#### Scenario: Frontmatter offset skips frontmatter lines
- Given content `"---\ntitle: hi\n---\n- [[Real Item]]"` with `frontmatter_body_start=18`
- When `scan_markdown` is called
- Then the result SHALL contain 1 list item with `text="[[Real Item]]"` at `line=3`

### Requirement: WASM export SHALL return valid JSON for the scan result

The `#[wasm_bindgen]` exported `scan_markdown` function SHALL serialize the Rust `ScanResult` to a JSON string that can be parsed by the TypeScript adapter into typed `DvList[]` and `HeadingCache[]` objects.

#### Scenario: WASM export returns valid JSON
- Given any valid markdown content
- When the `scan_markdown` WASM export is called from JavaScript
- Then it SHALL return a JSON string parseable to `{ lists: [...], headers: [...] }`

#### Scenario: TypeScript adapter produces correct types
- Given the JSON output from the WASM `scan_markdown` function
- When `adaptScanResult(json)` is called
- Then it SHALL return `{ lists: DvList[], headers: HeadingCache[] }` with `parent` as `undefined` (not `null`) when absent

### Requirement: Rust list scanner SHALL produce identical output to TypeScript parser for all fixture files

The Rust `scan_markdown` MUST produce deeply equal output to the TypeScript `scanMarkdown` function when given the same inputs. This SHALL be verified by running both parsers on all integration test fixture `.md` files and asserting structural equality.

#### Scenario: Conformance across all fixtures
- Given all `.md` fixture files in `packages/core/src/__tests__/integration/fixtures/`
- When both the Rust `scan_markdown` and TypeScript `scanMarkdown` are called on each file with the same parameters (content, file path, body start from frontmatter parse, archive tag "archive")
- Then the outputs SHALL be deeply equal — same `lists` array with identical field values for each item, and same `headers` array with identical field values

#### Scenario: CRLF handling matches TypeScript
- Given markdown content with `\r\n` line endings
- When `scan_markdown` is called
- Then the result SHALL be identical to the same content with `\n` line endings (matching TypeScript behavior)
