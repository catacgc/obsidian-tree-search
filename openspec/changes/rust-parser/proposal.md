# Rust-Based Indexing Parser

## Why

The current indexing pipeline is CPU-bound TypeScript that parses markdown files line-by-line with regex (`scanMarkdown` in `packages/core/src/parser/list-scanner.ts`), invokes `markdown-it` per list item (`parseTokens` in `packages/core/src/parser/inline-tokens.ts`), and extracts YAML frontmatter with `js-yaml` (`parseFrontmatter` in `packages/core/src/parser/frontmatter.ts`). On mobile (Obsidian iOS/Android), where the JavaScript engine is significantly slower than desktop V8/JSC, full-vault indexing is noticeably slow compared to the previous Dataview-based approach.

The hot path for a vault with N files and M total list items:
- `parseFrontmatter` called N times (js-yaml YAML parsing)
- `scanMarkdown` called N times (line-by-line regex scanning over all content)
- `parseTokens` called M times (markdown-it `parseInline` per list item in `indexer.ts:53`)
- `parseTokens` called per frontmatter parent string (`indexer.ts:238`)
- `parseTokens` called per canvas text line (`text-lines.ts:82`)

For a 5,000-note vault with ~20 list items per note, this is 5,000 YAML parses, 5,000 full-file regex scans, and ~100,000 markdown-it inline parses — all in single-threaded JavaScript.

Moving the parsing layer to Rust compiled to WebAssembly provides major speedup for regex and string processing, runs on all platforms (desktop Electron, mobile WebView, Bun CLI), and maintains the existing `@mdtree/core` I/O-free constraint.

## Scope

- A new `packages/parser-native/` workspace package containing Rust source and WASM build tooling
- Rust implementation of frontmatter extraction (full YAML parsing — all key-value pairs, not just hardcoded fields — since `parentRelation` is user-configurable via `IndexSettings`)
- Rust implementation of `scanMarkdown` (list item detection, header detection, indent tracking, tag extraction, task detection, parent wiring, section tracking)
- Rust implementation of inline token parsing (`parseTokens` — obsidian links, markdown links, images, text with decorations, meta-action/meta-mdtree extraction)
- A TypeScript adapter in `packages/parser-native/` that deserializes WASM output into existing `@mdtree/core` types (`DvList[]`, `HeadingCache[]`, `ParsedTextToken[]`, `Frontmatter`)
- A `ParserProvider` interface in `@mdtree/core` with two capabilities: (a) batch file parsing returning `DvPage[]`, and (b) standalone `parseTokens(text) -> ParsedTextToken[]` for call sites outside the batch flow (canvas path in `text-lines.ts:82`, frontmatter parent parsing in `indexer.ts:238`)
- A chunked batch parse API that processes files in chunks of 50-100 per WASM call, yielding to the event loop between chunks to preserve mobile responsiveness
- Integration points in `@mdtree/core` covering: `parseVaultFile`, `buildGraphFromScanner` (batch markdown), `buildNodesFromTextLines` (canvas inline tokens), and `indexSinglePage` (frontmatter parent tokens)
- Transparent fallback to the existing TypeScript parser when WASM is unavailable or fails to load
- A benchmark harness comparing TS vs WASM parser performance on realistic vault data
- CI integration for building the WASM artifact

## Non-goals

- Replacing the graph construction logic (`NotesGraph`, `indexSinglePage`) — graph operations are Map-based JS object manipulation best left in TypeScript
- Replacing the search layer (`searchIndex`, `advancedSearch`) — operates on the already-built in-memory graph
- Moving I/O to Rust — file reading stays behind the `VaultScanner` interface
- Native binary (non-WASM) builds for the Obsidian plugin — WASM is the only portable target for plugin distribution
- Changing the public API shape of `@mdtree/core` — consumers pass in a `ParserProvider` but the default behavior is unchanged
- Rust implementation of the CLI's SQLite persistence layer
- Performance optimization of the graph builder's batching/yielding logic beyond what is needed for chunked WASM calls
- Canvas file parsing logic in Rust (only inline token parsing within canvas text lines is accelerated)

## Acceptance criteria

- `packages/parser-native/` builds a `.wasm` artifact from Rust source using `wasm-pack` (or equivalent)
- The WASM parser produces structurally identical output to the TypeScript parser for all existing test fixtures in `packages/core/src/__tests__/integration/fixtures/` (deep equality, not byte comparison — field ordering may differ)
- All existing tests pass (`bun run mdtree:test`) with the native parser active
- All existing tests pass with the native parser unavailable (fallback to TS parser)
- `bun run build` produces a plugin bundle that includes the WASM artifact and loads it at runtime
- The plugin loads and indexes successfully on Obsidian mobile (iOS Safari WebView 16+, Android Chrome WebView 91+) using inline WASM loading (no filesystem access)
- Full-vault indexing parse phase (excluding I/O from `VaultScanner.readFile`) of a 2,000-note vault is at least 3x faster with WASM parser vs TS parser
- Incremental single-file reindex shows at least 2x speedup in the parse phase
- The batch API processes files in chunks (50-100 per WASM call), yielding to the event loop between chunks, preserving mobile UI responsiveness
- The WASM module compressed size is under 2 MB
- The `@mdtree/core` package remains I/O-free — no `bun:*`, no `node:fs`, no WASM loading logic inside core; loading is injected by consumers
- The `ParserProvider` interface exposes a standalone `parseTokens(text) -> ParsedTextToken[]` function usable by `indexSinglePage` (frontmatter parent strings at `indexer.ts:238`) and `buildNodesFromTextLines` (canvas text lines at `text-lines.ts:82`)
- The Rust inline token parser (`parseTokens`) produces identical `ParsedTextToken[]` arrays for all `rawText` values present in existing test fixtures — covering obsidian links, markdown links, images, text decorations, meta-actions, and meta-mdtree directives
- The Rust frontmatter parser emits all key-value pairs from valid YAML frontmatter (not just `aliases`/`tags`/`parent`) since `parentRelation` is user-configurable
- If WASM instantiation fails at runtime, the plugin falls back to the TS parser transparently with a console warning — no user-visible error or crash
- The Rust source has its own test suite validating parser correctness independently of the TypeScript tests

## Planned slice sequence

- `rust-parser-01-scaffold` — Create `packages/parser-native/` with Cargo workspace, wasm-pack config, minimal Rust lib exporting a trivial function, TypeScript wrapper that loads the WASM module, and `ParserProvider` interface definition in `@mdtree/core`
- `rust-parser-02-frontmatter` — Implement full YAML frontmatter extraction in Rust (boundary detection, all key-value pairs including arrays and nested values) with TypeScript adapter returning `Frontmatter` (`Record<string, unknown>`)
- `rust-parser-03-list-scanner` — Implement `scanMarkdown` equivalent in Rust (line iteration, header regex, list-item regex, indent stack, tag extraction, task detection, parent wiring, section tracking) returning serialized `DvList[]` and `HeadingCache[]`
- `rust-parser-04-inline-tokens` — Implement `parseTokens` equivalent in Rust (obsidian `[[link]]` parsing, markdown link/image detection, HTTP URL detection, text decoration spans, meta-action/meta-mdtree extraction) returning serialized `ParsedTextToken[]`; expose as both batch-internal and standalone callable
- `rust-parser-05-batch-api` — Add chunked batch endpoint that accepts file tuples, processes them in configurable chunk sizes (default 50-100 files per WASM call), and returns parsed `DvPage` structures; design the chunk boundary to allow event-loop yielding between chunks
- `rust-parser-06-core-integration` — Wire `@mdtree/core` to accept an externally-injected `ParserProvider` via strategy pattern: `buildGraphFromScanner` accepts optional provider for batch parsing, `indexSinglePage` and `buildNodesFromTextLines` use provider's `parseTokens` when available, with transparent fallback to TS implementations
- `rust-parser-07-plugin-bundle` — Configure esbuild to inline the WASM artifact (base64 data URL loader plugin for mobile compatibility with CJS format), add WASM loading and `ParserProvider` instantiation in plugin `onload`, verify mobile load on iOS and Android WebViews
- `rust-parser-08-benchmarks` — Create benchmark harness with synthetic vaults (1k and 5k notes), measure parse-phase-only TS vs WASM performance for full index and single-file reindex, document results
- `rust-parser-09-ci-build` — Add CI workflow for WASM build (Rust toolchain + wasm-pack), Rust test suite, and full TypeScript test suite (`bun test`) with WASM parser active

## Constraints

- The Rust parser must produce structurally identical output to the TypeScript parser — the existing TypeScript test suite is the contract
- WASM module must be loadable via `WebAssembly.instantiate(bytes)` in both Obsidian WebView (mobile) and Bun/Node environments — no reliance on `fetch()` or `WebAssembly.instantiateStreaming`
- The `packages/core/` hard boundary remains: no I/O, no `bun:*`, no `node:fs` — `ParserProvider` is injected from outside, not loaded within core
- Serialization between Rust and TypeScript uses JSON (`serde_json` in Rust, `JSON.parse` in JS) — debuggable and sufficient given batch amortization of per-call overhead
- Batch processing must respect event-loop yielding: chunks of 50-100 files per WASM call with `setTimeout(0)` between chunks, matching the existing `BATCH_SIZE = 10` yielding pattern in `builder.ts`
- The existing TypeScript parser must remain as a working fallback — it is not deleted
- The `ParserProvider` must expose standalone `parseTokens` for use outside the batch flow (canvas path, frontmatter parent parsing)
