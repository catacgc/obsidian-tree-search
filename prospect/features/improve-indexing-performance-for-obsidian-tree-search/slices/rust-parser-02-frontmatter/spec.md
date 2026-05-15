# Spec Delta: rust-parser-02-frontmatter

## ADDED Requirements

### Requirement: Frontmatter Boundary Detection

The Rust frontmatter parser SHALL correctly detect YAML frontmatter delimited by `---` markers at the start of a markdown file.

#### Scenario: Standard frontmatter block detected

- **Given** a markdown string starting with `---\n` followed by YAML content followed by `\n---`
- **When** `parse_frontmatter` is called with that string
- **Then** the function MUST return the parsed YAML content as the `frontmatter` field
- **And** the `bodyStart` field MUST equal the byte length from position 0 through the end of the closing `---` delimiter (not including any newline after it)

#### Scenario: No frontmatter present

- **Given** a markdown string that does NOT start with `---\n` (e.g., starts with `# Header` or plain text)
- **When** `parse_frontmatter` is called with that string
- **Then** the `frontmatter` field MUST be an empty object `{}`
- **And** the `bodyStart` field MUST be `0`

#### Scenario: CRLF line endings in frontmatter

- **Given** a markdown string with frontmatter using `\r\n` line endings (i.e., `---\r\n...\r\n---`)
- **When** `parse_frontmatter` is called with that string
- **Then** the function MUST correctly detect the boundaries
- **And** the returned `frontmatter` and `bodyStart` MUST be logically equivalent to the same content with `\n` endings (with `bodyStart` accounting for the extra `\r` bytes)

#### Scenario: Empty frontmatter block

- **Given** a markdown string `"---\n---\nbody"`
- **When** `parse_frontmatter` is called
- **Then** the `frontmatter` field MUST be an empty object `{}`
- **And** `bodyStart` MUST equal 7 (length of `"---\n---"`)

---

### Requirement: Full YAML Value Parsing

The Rust frontmatter parser SHALL parse all standard YAML value types and return them as their JSON equivalents.

#### Scenario: String scalar values

- **Given** frontmatter containing `title: "Hello World"` or `title: Hello World`
- **When** `parse_frontmatter` is called
- **Then** `frontmatter.title` MUST be the string `"Hello World"`

#### Scenario: Array values (block style)

- **Given** frontmatter containing:
  ```yaml
  aliases:
    - Alias1
    - Alias2
  ```
- **When** `parse_frontmatter` is called
- **Then** `frontmatter.aliases` MUST be the array `["Alias1", "Alias2"]`

#### Scenario: Array values (flow style)

- **Given** frontmatter containing `tags: [work, personal]`
- **When** `parse_frontmatter` is called
- **Then** `frontmatter.tags` MUST be the array `["work", "personal"]`

#### Scenario: Numeric values

- **Given** frontmatter containing `count: 42`
- **When** `parse_frontmatter` is called
- **Then** `frontmatter.count` MUST be the number `42`

#### Scenario: Boolean values

- **Given** frontmatter containing `draft: true`
- **When** `parse_frontmatter` is called
- **Then** `frontmatter.draft` MUST be the boolean `true`

#### Scenario: Null values

- **Given** frontmatter containing `empty:` (YAML null)
- **When** `parse_frontmatter` is called
- **Then** `frontmatter.empty` MUST be `null`

#### Scenario: Nested objects

- **Given** frontmatter containing:
  ```yaml
  metadata:
    author: Jane
    version: 2
  ```
- **When** `parse_frontmatter` is called
- **Then** `frontmatter.metadata` MUST be the object `{ "author": "Jane", "version": 2 }`

#### Scenario: String containing obsidian link syntax

- **Given** frontmatter containing `parent: "[[Root]]"`
- **When** `parse_frontmatter` is called
- **Then** `frontmatter.parent` MUST be the string `"[[Root]]"` (preserved verbatim, not interpreted)

---

### Requirement: Error Handling for Malformed YAML

The Rust frontmatter parser SHALL gracefully handle malformed YAML without crashing.

#### Scenario: Invalid YAML syntax in frontmatter block

- **Given** a markdown string with `---` delimiters but invalid YAML content between them (e.g., `"---\n{unclosed\n---\nbody"`)
- **When** `parse_frontmatter` is called
- **Then** the `frontmatter` field MUST be an empty object `{}`
- **And** `bodyStart` MUST still advance past the `---` block (same offset as if parsing succeeded)

#### Scenario: Non-object top-level YAML

- **Given** a markdown string with frontmatter that parses to a YAML sequence (e.g., `"---\n- item1\n- item2\n---\n"`) or scalar
- **When** `parse_frontmatter` is called
- **Then** the `frontmatter` field MUST be an empty object `{}` (only mapping/object frontmatter is valid)
- **And** `bodyStart` MUST advance past the block

---

### Requirement: WASM Export for Frontmatter Parsing

The `parse_frontmatter` function SHALL be exported via `wasm_bindgen` and callable from JavaScript.

#### Scenario: Calling parse_frontmatter from JavaScript via WASM

- **Given** the WASM module is loaded and instantiated
- **When** `parse_frontmatter(content)` is called with a markdown string containing frontmatter
- **Then** it MUST return a valid JSON string
- **And** the JSON MUST conform to the schema `{ "frontmatter": object, "bodyStart": number }`

#### Scenario: Output field names use camelCase

- **Given** the WASM module is loaded
- **When** `parse_frontmatter` is called and the result is parsed as JSON
- **Then** the body offset field MUST be named `bodyStart` (camelCase, not `body_start`)

---

### Requirement: TypeScript Adapter for Frontmatter

The `packages/parser-native/ts/adapter.ts` module SHALL export a function to deserialize WASM frontmatter output into the `@mdtree/core` `Frontmatter` type.

#### Scenario: Adapting valid frontmatter JSON

- **Given** a JSON string returned by the WASM `parse_frontmatter` function
- **When** `adaptFrontmatter(json)` is called
- **Then** it MUST return an object `{ frontmatter: Frontmatter; bodyStart: number }`
- **And** the `frontmatter` field MUST be a plain JavaScript object (`Record<string, unknown>`)
- **And** the `bodyStart` field MUST be a number

#### Scenario: Adapted output matches TypeScript parser output

- **Given** any markdown string with valid YAML frontmatter
- **When** the string is parsed by both the Rust parser (via WASM + adapter) and the TS `parseFrontmatter` function
- **Then** the adapted Rust output `frontmatter` MUST deep-equal the TS output `frontmatter`
- **And** the adapted Rust output `bodyStart` MUST equal the TS output `bodyStart`

---

### Requirement: Conformance with TypeScript Parser

The Rust frontmatter parser MUST produce structurally identical output to the TypeScript `parseFrontmatter` function for all supported inputs.

#### Scenario: Conformance on existing fixture files

- **Given** the fixture files `aliases/meeting notes.md` (aliases array) and `multi-page/index.md` (parent with obsidian link)
- **When** both the Rust parser and TS `parseFrontmatter` are called on each file's content
- **Then** the outputs MUST be identical (deep equality on `frontmatter` object and exact match on `bodyStart`)

#### Scenario: Conformance on edge cases

- **Given** inputs including: empty frontmatter block, no frontmatter, malformed YAML, CRLF endings, nested objects, flow-style arrays, boolean/number values, and null values
- **When** both parsers process each input
- **Then** the outputs MUST be identical for every case (deep equality on `frontmatter`, exact match on `bodyStart`)
