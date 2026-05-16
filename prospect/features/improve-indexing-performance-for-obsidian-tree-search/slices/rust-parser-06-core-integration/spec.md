# Spec Delta: rust-parser-06-core-integration

## ADDED Requirements

### Requirement: ParserProvider Integration in buildGraphFromScanner

The `buildGraphFromScanner` function in `packages/core/src/graph/builder.ts` SHALL accept an optional `ParserProvider` parameter and, when provided, process markdown files via chunked batch parsing with event-loop yielding between chunks.

#### Scenario: Batch parsing when provider is supplied

- **Given** a `VaultScanner` with 120 `.md` files and a `ParserProvider` with `chunkSize = 50`
- **When** `buildGraphFromScanner(scanner, settings, provider, 50)` is called
- **Then** `provider.parseBatchChunk` MUST be invoked 3 times (with 50, 50, and 20 file inputs respectively)
- **And** `provider.parseVaultFile` MUST NOT be called for `.md` files
- **And** the returned `NotesGraph` MUST contain the same nodes and edges as calling `buildGraphFromScanner(scanner, settings)` without a provider

#### Scenario: Event-loop yielding between chunks

- **Given** a `VaultScanner` with more than `chunkSize` `.md` files
- **When** `buildGraphFromScanner(scanner, settings, provider, chunkSize)` is called
- **Then** the function MUST yield the event loop (via `await setTimeout(0)` or equivalent) between each `parseBatchChunk` call
- **And** the function MUST return a `Promise<NotesGraph>`

#### Scenario: Canvas files use provider.parseTokens

- **Given** a `VaultScanner` with a `.canvas` file containing a text node with `[[Link]]` and a `ParserProvider`
- **When** `buildGraphFromScanner(scanner, settings, provider)` is called
- **Then** the provider's `parseTokens` method MUST be used for inline token parsing within canvas text lines
- **And** the canvas graph nodes MUST be structurally identical to those produced without a provider

#### Scenario: Fallback behavior without provider

- **Given** a `VaultScanner` with multiple files
- **When** `buildGraphFromScanner(scanner, settings)` is called WITHOUT a provider parameter
- **Then** the function MUST process files one-by-one using `parseVaultFile` (direct TS import) and `indexSinglePage` per file
- **And** it MUST yield every 10 files (matching the existing `BATCH_SIZE = 10` behavior)
- **And** all behavior MUST be identical to the implementation prior to this slice

#### Scenario: Default chunk size

- **Given** a provider but no explicit `chunkSize` parameter
- **When** `buildGraphFromScanner(scanner, settings, provider)` is called
- **Then** the default chunk size MUST be 50

---

### Requirement: ParserProvider Integration in reindexFileInGraph

The `reindexFileInGraph` function SHALL accept an optional `ParserProvider` parameter and use it for parsing the reindexed file.

#### Scenario: Reindex .md file with provider

- **Given** a graph containing nodes from a `.md` file and a `ParserProvider`
- **When** `reindexFileInGraph(relPath, graph, scanner, settings, provider)` is called for that `.md` file
- **Then** `provider.parseVaultFile(content, relPath, mtime, archiveTag)` MUST be called
- **And** the returned `DvPage` (with pre-computed tokens) MUST be passed to `indexSinglePage`
- **And** `indexSinglePage` MUST use `precomputedTokens` from the DvList items

#### Scenario: Reindex .canvas file with provider

- **Given** a `.canvas` file and a `ParserProvider`
- **When** `reindexFileInGraph(relPath, graph, scanner, settings, provider)` is called for that canvas file
- **Then** `provider.parseTokens` MUST be used as the `parseTokensFn` for canvas text line parsing

#### Scenario: Reindex without provider uses fallback

- **Given** a graph and a file to reindex
- **When** `reindexFileInGraph(relPath, graph, scanner, settings)` is called without a provider
- **Then** behavior MUST be identical to the implementation prior to this slice

---

### Requirement: Pre-computed Token Resolution in indexSinglePage

The `indexSinglePage` function SHALL resolve inline tokens from `DvList.precomputedTokens` when available, falling back to a callable `parseTokensFn` parameter only when pre-computed tokens are absent.

#### Scenario: precomputedTokens used for list item (line 53)

- **Given** a `DvPage` where a `DvList` item has `precomputedTokens` populated with a `ParsedTextToken[]` array
- **When** `indexSinglePage(page, graph, settings)` processes that item
- **Then** the function MUST use `item.precomputedTokens` directly for graph construction
- **And** it MUST NOT call any parse function for that item's `rawText`

#### Scenario: Fallback when precomputedTokens is undefined (line 53)

- **Given** a `DvPage` where a `DvList` item has `precomputedTokens` as `undefined`
- **When** `indexSinglePage(page, graph, settings, parseTokensFn)` processes that item
- **Then** the function MUST call `parseTokensFn(item.rawText)` to obtain tokens
- **And** if no `parseTokensFn` is provided, it MUST default to the TS `parseTokens` function

#### Scenario: precomputedParentTokens used for frontmatter parents (line 238)

- **Given** a `DvPage` with frontmatter `parent: "[[Root]]"` and `precomputedParentTokens` containing key `"[[Root]]"` mapped to a token array
- **When** `indexSinglePage(page, graph, settings)` processes the frontmatter parent relation
- **Then** it MUST use `page.precomputedParentTokens.get("[[Root]]")` for that parent string
- **And** it MUST NOT call any parse function for that parent string

#### Scenario: Fallback when precomputedParentTokens is undefined (line 238)

- **Given** a `DvPage` with frontmatter `parent: "[[Root]]"` and `precomputedParentTokens` as `undefined`
- **When** `indexSinglePage(page, graph, settings, parseTokensFn)` processes the frontmatter parent relation
- **Then** it MUST call `parseTokensFn("[[Root]]")` to obtain tokens for graph edge construction

#### Scenario: Custom parseTokensFn parameter

- **Given** a custom function `myParseFn` passed as the fourth argument to `indexSinglePage`
- **When** processing list items without `precomputedTokens` and parent strings without `precomputedParentTokens`
- **Then** `myParseFn` MUST be called instead of the default TS `parseTokens`

---

### Requirement: parseTokensFn Threading in Canvas Path

The `buildNodesFromTextLines` function and `parseCanvasData` function SHALL accept an optional `parseTokensFn` parameter to allow native parser injection for canvas inline token parsing.

#### Scenario: parseCanvasData accepts parseTokensFn

- **Given** a canvas data structure and a custom `parseTokensFn`
- **When** `parseCanvasData(path, basename, canvasData, graph, parseTokensFn)` is called
- **Then** `parseTokensFn` MUST be threaded to `buildNodesFromTextLines`
- **And** all inline token parsing within canvas text nodes MUST use the provided function

#### Scenario: buildNodesFromTextLines uses parseTokensFn for text nodes

- **Given** `NodeTextLine[]` entries of type `"list"` and a custom `parseTokensFn`
- **When** `buildNodesFromTextLines(lines, pageNode, graph, onFirstKey, parseTokensFn)` is called
- **Then** text node creation MUST call `parseTokensFn(text)` instead of the directly imported `parseTokens`

#### Scenario: Default parseTokensFn when not provided

- **Given** `buildNodesFromTextLines` or `parseCanvasData` called without a `parseTokensFn` parameter
- **When** text nodes are processed
- **Then** the function MUST default to using the TS `parseTokens` import from `"./inline-tokens.ts"`

---

### Requirement: Transparent Backward Compatibility

All modifications to function signatures in this slice SHALL be backward-compatible — existing call sites that do not pass the new optional parameters MUST continue to work identically to before.

#### Scenario: All existing tests pass without modification

- **Given** the full test suite in `packages/core/src/__tests__/` (builder.test.ts, indexer.test.ts, integration tests, parser-provider.test.ts, etc.)
- **When** `bun test packages/core` is executed
- **Then** all tests MUST pass without any test code changes
- **And** graph structures produced MUST be identical to pre-slice behavior

#### Scenario: indexSinglePage called with three arguments (existing pattern)

- **Given** existing code calling `indexSinglePage(page, graph, settings)` (no fourth argument)
- **When** the function executes
- **Then** it MUST behave identically to the pre-slice implementation (defaulting to TS `parseTokens`)

#### Scenario: buildGraphFromScanner called with two arguments (existing pattern)

- **Given** existing code calling `buildGraphFromScanner(scanner, settings)` (no third/fourth arguments)
- **When** the function executes
- **Then** it MUST use the file-by-file fallback path with yield every 10 files
- **And** behavior MUST be identical to the pre-slice implementation

#### Scenario: parseCanvasData called with four arguments (existing pattern)

- **Given** existing code calling `parseCanvasData(path, basename, canvasData, graph)` (no fifth argument)
- **When** the function executes
- **Then** it MUST default to using the TS `parseTokens` for inline token parsing
