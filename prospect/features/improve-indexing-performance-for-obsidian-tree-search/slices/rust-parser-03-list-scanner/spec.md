# Spec Delta: rust-parser-03-list-scanner

## ADDED Requirements

### Requirement: Structural Output Equivalence with TypeScript scanMarkdown

The Rust `scan_markdown` function SHALL produce structurally identical `DvList[]` and `HeadingCache[]` output to the TypeScript `scanMarkdown` function for all valid markdown inputs.

#### Scenario: Header detection produces correct HeadingCache entries

- **Given** a markdown string containing ATX headers (e.g., `# Alpha\n## Beta\n### Gamma`)
- **When** `scan_markdown` is called with that string
- **Then** the `headers` array MUST contain one entry per header
- **And** each entry MUST have `heading` set to the header text with leading/trailing whitespace trimmed
- **And** each entry MUST have `level` set to the number of `#` characters (1-6)
- **And** each entry MUST have `position.start.line` set to the zero-based line number and `position.start.ch` set to 0
- **And** each entry MUST have `position.end.line` set to the same line number and `position.end.ch` set to the byte length of the entire line

#### Scenario: List item detection with all bullet types

- **Given** a markdown string with list items using `-`, `*`, `+`, or `N.` prefixes followed by content containing `[[links]]`
- **When** `scan_markdown` is called
- **Then** the `lists` array MUST contain one `DvList` entry per detected list item
- **And** each entry MUST have `text` set to the captured content after the bullet prefix, trimmed of whitespace
- **And** each entry MUST have `position.start.col` set to the indentation level (number of leading whitespace characters)
- **And** each entry MUST have `position.end.col` set to the byte length of the entire line

#### Scenario: Task marker detection and text extraction

- **Given** a list item whose text starts with `[ ]`, `[x]`, or `[X]` followed by a space
- **When** `scan_markdown` is called
- **Then** the `DvList` entry MUST have `task` set to `true`
- **And** `completed` MUST be `true` if the marker is `[x]` or `[X]`, `false` if `[ ]`
- **And** `text` MUST be the content after the task marker, trimmed of whitespace

#### Scenario: Pure prose list items are skipped

- **Given** a list item whose text (after task-marker stripping and meta-action stripping) contains none of `[[`, `![[`, `#`, `http`, or `- [`
- **And** either `rawText` equals `text` (no meta-actions were present) or `text` is empty
- **When** `scan_markdown` is called
- **Then** that item MUST NOT appear in the output `lists` array

#### Scenario: Items with task-reference pattern are NOT skipped

- **Given** a list item whose text contains `- [` (task reference syntax, e.g., `see also - [x] finished`) but does NOT contain `[[`, `![[`, or `http`
- **And** the text does contain `#` (from the `- [` check triggering keep) OR contains `- [` itself
- **When** `scan_markdown` is called
- **Then** that item MUST appear in the output `lists` array (it is NOT skipped)

---

### Requirement: Parent-Child Wiring via Indent Stack

The Rust `scan_markdown` function SHALL wire parent-child relationships between list items using an indent stack, identically to the TypeScript implementation.

#### Scenario: Nested item gets parent line number

- **Given** a markdown string `- [[A]]\n  - [[B]]` where B is indented under A
- **When** `scan_markdown` is called
- **Then** B's `parent` field MUST be set to A's line number

#### Scenario: Sibling items have no parent

- **Given** a markdown string `- [[A]]\n- [[B]]` where both items have the same indent level and no prior indented parent
- **When** `scan_markdown` is called
- **Then** both A's and B's `parent` field MUST be `undefined` (serialized as JSON `null`)

#### Scenario: De-dent resets parent correctly

- **Given** a markdown string `- [[A]]\n  - [[B]]\n- [[C]]` where C returns to the root indent
- **When** `scan_markdown` is called
- **Then** C's `parent` field MUST be `undefined`

#### Scenario: Header resets indent stack

- **Given** list items before and after a header: `- [[Pre]]\n  - [[Nested]]\n# New\n- [[Post]]`
- **When** `scan_markdown` is called
- **Then** Post's `parent` field MUST be `undefined` (indent stack was cleared by the header)

#### Scenario: Deep nesting produces correct chain

- **Given** `- [[A]]\n  - [[B]]\n    - [[C]]`
- **When** `scan_markdown` is called
- **Then** B's `parent` MUST be A's line, C's `parent` MUST be B's line

#### Scenario: Children array populated in post-pass

- **Given** `- [[Parent]]\n  - [[Child A]]\n  - [[Child B]]`
- **When** `scan_markdown` is called
- **Then** Parent's `children` array MUST contain Child A and Child B (in order)
- **And** Child A and Child B MUST have empty `children` arrays

---

### Requirement: Section Subpath Tracking from Headers

The Rust `scan_markdown` function SHALL track the current section subpath based on the most recent header.

#### Scenario: Items under a header get section subpath

- **Given** `# Setup\n\n- [[Config]]`
- **When** `scan_markdown` is called
- **Then** the Config item's `section.subpath` MUST be `"#Setup"`

#### Scenario: Subpath updates on new header

- **Given** `# First\n- [[A]]\n# Second\n- [[B]]`
- **When** `scan_markdown` is called
- **Then** A's `section.subpath` MUST be `"#First"` and B's MUST be `"#Second"`

#### Scenario: Items before any header have empty subpath

- **Given** `- [[A]]` (no header precedes it)
- **When** `scan_markdown` is called
- **Then** A's `section.subpath` MUST be `""` (empty string)

---

### Requirement: Meta-Action and Meta-Mdtree Stripping with rawText Preservation

The Rust `scan_markdown` function SHALL strip meta-action and meta-mdtree annotations from `text` while preserving them in `rawText`.

#### Scenario: Meta-action triple stripped from text

- **Given** `- https://example.com (meta-action-name::Open)(meta-action-url::https://x.com)(meta-action-icon::globe)`
- **When** `scan_markdown` is called
- **Then** `text` MUST be `"https://example.com"` (trimmed after stripping)
- **And** `rawText` MUST contain `"meta-action-name::Open"` and `"meta-action-url::https://x.com"`

#### Scenario: Meta-mdtree directive stripped from text

- **Given** `- [[Beta]] done (meta-mdtree:: archive)`
- **When** `scan_markdown` is called
- **Then** `text` MUST be `"[[Beta]] done"` (trimmed after stripping)
- **And** `rawText` MUST contain `"meta-mdtree:: archive"`

#### Scenario: Item with meta-action on otherwise plain text is not skipped

- **Given** `- Buy milk (meta-action-name::Open)(meta-action-url::https://todoist.com/1)`
- **When** `scan_markdown` is called
- **Then** the item MUST appear in the output (not skipped) because `rawText != text`
- **And** `text` MUST be `"Buy milk"`

#### Scenario: Meta-only item (no real content) is skipped

- **Given** `- (meta-action-name::X)(meta-action-url::https://x.com)` (after stripping, text is empty)
- **When** `scan_markdown` is called
- **Then** the item MUST NOT appear in the output
- **Because** `text` is empty → the `text.is_empty()` condition triggers → `shouldSkip("")` returns true (no keep-patterns in empty string)

#### Scenario: rawText equals text when no meta annotations present

- **Given** `- [[Note]] regular text`
- **When** `scan_markdown` is called
- **Then** `rawText` MUST equal `text`

---

### Requirement: Archive Tag Filtering

The Rust `scan_markdown` function SHALL skip list items that contain the archive tag.

#### Scenario: Item with archive tag is skipped

- **Given** `- [[Note]] #archive` with `archiveTag = "archive"`
- **When** `scan_markdown` is called
- **Then** the item MUST NOT appear in the output lists
- **Because** `shouldSkip` detects `#archive` in the text (the archive tag is checked as `#` + archiveTag)

#### Scenario: Item with different tag is kept

- **Given** `- [[Note]] #todo` with `archiveTag = "archive"`
- **When** `scan_markdown` is called
- **Then** the item MUST appear in the output lists

---

### Requirement: Frontmatter Body-Start Offset Handling

The Rust `scan_markdown` function SHALL begin scanning from the line corresponding to the `frontmatterBodyStart` byte offset.

#### Scenario: Scanning starts after frontmatter

- **Given** content `"---\ntitle: hi\n---\n- [[Item]]"` with `frontmatterBodyStart = 18` (length of `---\ntitle: hi\n---\n`)
- **When** `scan_markdown` is called
- **Then** the `lists` array MUST contain the `[[Item]]` entry
- **And** no items from within the frontmatter block SHALL appear

#### Scenario: Zero offset starts at line zero

- **Given** any content with `frontmatterBodyStart = 0`
- **When** `scan_markdown` is called
- **Then** scanning MUST begin at line 0

---

### Requirement: WASM Export and TypeScript Adapter

The `scan_markdown` function SHALL be exported via `#[wasm_bindgen]` and the TypeScript adapter SHALL correctly deserialize its output.

#### Scenario: WASM export returns valid JSON

- **Given** the WASM module is loaded and `scan_markdown` is called with valid markdown
- **When** the result is received as a string
- **Then** it MUST be valid JSON conforming to the schema `{ "lists": [...], "headers": [...] }`

#### Scenario: Adapter converts null parent to undefined

- **Given** a JSON result from `scan_markdown` where a list item has `"parent": null`
- **When** `adaptScanResult(json)` is called
- **Then** the resulting `DvList` item MUST have `parent` as `undefined` (not `null`)

#### Scenario: Adapter produces deep-equal output to TypeScript scanMarkdown

- **Given** any integration fixture file from `packages/core/src/__tests__/integration/fixtures/`
- **When** both the Rust `scan_markdown` (via WASM + adapter) and TypeScript `scanMarkdown` are called with the same parameters
- **Then** the results MUST be deep-equal (identical `lists` and `headers` arrays)
