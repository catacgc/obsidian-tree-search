# Spec Delta: rust-parser-05-batch-api

## ADDED Requirements

### Requirement: Batch Parse WASM Entry Point

The `packages/parser-native/` WASM module SHALL export a `batch_parse_chunk` function that processes multiple markdown files in a single WASM boundary crossing, producing complete `DvPage`-equivalent structures with pre-computed inline tokens.

#### Scenario: Batch parsing multiple files

- **Given** a JSON input array containing 3 file descriptors, each with `path`, `content`, `mtime`, and `archiveTag` fields
- **When** `batch_parse_chunk(jsonInput)` is called
- **Then** it MUST return a JSON string containing an array of exactly 3 page objects
- **And** each page object MUST contain `file` (with `aliases`, `name`, `mtime`, `path`, `frontmatter`, `lists`, `tags`), `headers`, and `precomputedParentTokens` fields

#### Scenario: Pre-computed tokens on every list item

- **Given** a file with 5 non-skipped list items, each having a `rawText` field
- **When** `batch_parse_chunk` processes this file
- **Then** every list item in the output (including nested children) MUST have a `precomputedTokens` array
- **And** each `precomputedTokens` array MUST be identical to the output of calling `parse_tokens(rawText)` for that item's `rawText`

#### Scenario: Pre-computed parent tokens from frontmatter

- **Given** a file with frontmatter containing `parent: "[[Root]]"`
- **When** `batch_parse_chunk` processes this file
- **Then** the output page MUST have a `precomputedParentTokens` object with key `"[[Root]]"`
- **And** the value for that key MUST be identical to calling `parse_tokens("[[Root]]")`

#### Scenario: Pre-computed parent tokens for array values

- **Given** a file with frontmatter containing `parent: ["[[A]]", "[[B]]"]`
- **When** `batch_parse_chunk` processes this file
- **Then** `precomputedParentTokens` MUST contain entries for both `"[[A]]"` and `"[[B]]"`

#### Scenario: No parent tokens when frontmatter has no links

- **Given** a file with frontmatter containing only `tags: [work]` and no obsidian link strings
- **When** `batch_parse_chunk` processes this file
- **Then** `precomputedParentTokens` MUST be an empty object `{}`

#### Scenario: Empty batch input

- **Given** an empty JSON array `"[]"` as input
- **When** `batch_parse_chunk("[]")` is called
- **Then** it MUST return the JSON string `"[]"`

#### Scenario: Root-only list items in output

- **Given** a file with nested list items (some items have a parent reference to another item's line)
- **When** `batch_parse_chunk` processes this file
- **Then** `file.lists.values` MUST contain only root items (those with no parent)
- **And** child items MUST appear recursively in their parent's `children` array
- **And** child items MUST also have `precomputedTokens` populated

---

### Requirement: Single File Parse WASM Entry Point

The WASM module SHALL export a `parse_single_file` function for incremental single-file reindex that produces the same complete structure as the batch API.

#### Scenario: Single file parse produces complete page structure

- **Given** a markdown file with frontmatter, headers, and list items
- **When** `parse_single_file(content, path, mtime, archiveTag)` is called
- **Then** it MUST return a JSON string with a page structure containing `file`, `headers`, and `precomputedParentTokens`
- **And** all list items MUST have `precomputedTokens` populated
- **And** `precomputedParentTokens` MUST be populated for link-containing frontmatter values

#### Scenario: Single file vs batch equivalence

- **Given** the same file processed via `parse_single_file(content, path, mtime, archiveTag)` and via `batch_parse_chunk` with a single-element input array containing `{path, content, mtime, archiveTag}`
- **When** both outputs are deserialized
- **Then** they MUST be structurally identical (deep equal)

---

### Requirement: DvList Type Extension for Pre-computed Tokens

The `DvList` type in `@mdtree/core` SHALL include an optional `precomputedTokens` field to carry pre-computed inline token arrays.

#### Scenario: DvList from native parser has precomputedTokens

- **Given** a `DvPage` produced by the `NativeParserProvider` batch or single-file API
- **When** any `DvList` item is accessed (including nested children)
- **Then** `item.precomputedTokens` MUST be a `ParsedTextToken[]` array (not undefined)

#### Scenario: DvList from TS parser has no precomputedTokens

- **Given** a `DvPage` produced by `TsParserProvider.parseBatchChunk` or `TsParserProvider.parseVaultFile`
- **When** any `DvList` item is accessed
- **Then** `item.precomputedTokens` MUST be `undefined`

#### Scenario: Existing tests unaffected by type addition

- **Given** the optional `precomputedTokens` field added to the `DvList` type definition
- **When** all existing tests in `packages/core` are executed
- **Then** all tests MUST pass without any modifications to test code

---

### Requirement: DvPage Type Extension for Pre-computed Parent Tokens

The `DvPage` type in `@mdtree/core` SHALL include an optional `precomputedParentTokens` field.

#### Scenario: DvPage from native parser has precomputedParentTokens

- **Given** a file with frontmatter containing string values with obsidian links (e.g., `parent: "[[Root]]"`)
- **When** `NativeParserProvider.parseVaultFile` or `parseBatchChunk` processes it
- **Then** `page.precomputedParentTokens` MUST be a `Map<string, ParsedTextToken[]>` with an entry for each link-containing frontmatter string value

#### Scenario: DvPage from TS parser has no precomputedParentTokens

- **Given** a `DvPage` produced by `TsParserProvider`
- **When** the page is accessed
- **Then** `page.precomputedParentTokens` MUST be `undefined`

---

### Requirement: NativeParserProvider Implementation

The `@mdtree/parser-native` package SHALL export a `NativeParserProvider` class that implements the `ParserProvider` interface using the WASM module.

#### Scenario: parseBatchChunk delegates to WASM batch function

- **Given** a `NativeParserProvider` instantiated with a loaded WASM handle
- **When** `provider.parseBatchChunk(files)` is called with an array of `FileInput` objects
- **Then** it MUST call the WASM `batch_parse_chunk` function with the JSON-serialized input
- **And** it MUST return `DvPage[]` where every `DvList` has `precomputedTokens` defined (not undefined)
- **And** every `DvPage` with link-containing frontmatter values MUST have `precomputedParentTokens` defined

#### Scenario: parseTokens delegates to WASM standalone function

- **Given** a `NativeParserProvider` instance
- **When** `provider.parseTokens("[[SomePage]]")` is called
- **Then** the result MUST be identical (deep equal) to calling `TsParserProvider.parseTokens("[[SomePage]]")`

#### Scenario: parseVaultFile delegates to WASM single-file function

- **Given** a `NativeParserProvider` instance and a markdown string with frontmatter and list items
- **When** `provider.parseVaultFile(content, path, mtime, archiveTag)` is called
- **Then** the returned `DvPage` MUST have `precomputedTokens` populated on all list items
- **And** the `DvPage` fields (excluding `precomputedTokens` and `precomputedParentTokens`) MUST be structurally identical to `TsParserProvider.parseVaultFile(...)` output for the same inputs

---

### Requirement: Chunked Batch Utility

The `@mdtree/parser-native` package SHALL export a `chunkedBatch` async utility function that processes files in configurable chunks with event-loop yielding between chunks.

#### Scenario: Files split into chunks of specified size

- **Given** 120 `FileInput` objects and a chunk size of 50
- **When** `chunkedBatch(provider, files, 50)` is called
- **Then** `provider.parseBatchChunk` MUST be invoked 3 times (with 50, 50, and 20 files respectively)
- **And** the final returned array MUST contain all 120 `DvPage` objects in input order

#### Scenario: Event-loop yielding between chunks

- **Given** files that require multiple chunks to process
- **When** `chunkedBatch` processes them
- **Then** it MUST yield the event loop (via `setTimeout(0)` or equivalent async mechanism) between consecutive `parseBatchChunk` calls
- **And** the function MUST return a `Promise<DvPage[]>`

#### Scenario: Single chunk does not yield unnecessarily

- **Given** 10 files and a chunk size of 50
- **When** `chunkedBatch(provider, files, 50)` is called
- **Then** `provider.parseBatchChunk` MUST be called exactly once with all 10 files
- **And** no event-loop yielding MUST occur after processing

#### Scenario: Default chunk size

- **Given** no explicit chunk size parameter
- **When** `chunkedBatch(provider, files)` is called
- **Then** it MUST use a default chunk size of 50

---

### Requirement: Batch Output Conformance with TS Parser

The native batch API output (excluding the `precomputedTokens` and `precomputedParentTokens` fields) SHALL produce structurally identical `DvPage` data as the TypeScript parser for the same inputs.

#### Scenario: Conformance across all integration test fixtures

- **Given** all `.md` files from `packages/core/src/__tests__/integration/fixtures/`
- **When** both `NativeParserProvider.parseBatchChunk(files)` and `TsParserProvider.parseBatchChunk(files)` process the same file inputs
- **Then** for each corresponding `DvPage` pair, the native output (with `precomputedTokens` recursively removed from all `DvList` items and `precomputedParentTokens` removed from the page) MUST deeply equal the TS output

#### Scenario: Pre-computed tokens match standalone parseTokens output

- **Given** a batch-parsed `DvPage` from the native parser
- **When** each `DvList.precomputedTokens` is compared to `TsParserProvider.parseTokens(item.rawText)`
- **Then** they MUST be deeply equal for every list item (including nested children) in every fixture file

#### Scenario: Frontmatter extraction matches TS parser

- **Given** a file with YAML frontmatter containing aliases, tags, and parent fields
- **When** processed by both native and TS parsers
- **Then** the `file.aliases.values`, `file.tags`, `file.frontmatter`, and `file.name` fields MUST be identical

---

### Requirement: WASM Module Exports Extension

The `WasmExports` and `NativeParserHandle` TypeScript types SHALL include the new batch API function signatures.

#### Scenario: WasmExports includes batch_parse_chunk

- **Given** the `WasmExports` type in `packages/parser-native/ts/loader.ts`
- **When** a WASM module is loaded via `loadWasm(bytes)`
- **Then** the returned object MUST include a `batch_parse_chunk` function accepting `(json_input: string)` and returning `string`

#### Scenario: WasmExports includes parse_single_file

- **Given** the `WasmExports` type in `packages/parser-native/ts/loader.ts`
- **When** a WASM module is loaded via `loadWasm(bytes)`
- **Then** the returned object MUST include a `parse_single_file` function accepting `(content: string, path: string, mtime: number, archive_tag: string)` and returning `string`

#### Scenario: NativeParserHandle matches WasmExports

- **Given** the `NativeParserHandle` type in `packages/parser-native/ts/index.ts`
- **When** compared to `WasmExports`
- **Then** it MUST include all the same function signatures including `batch_parse_chunk` and `parse_single_file`
