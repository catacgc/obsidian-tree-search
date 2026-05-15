## Why

The current indexing pipeline is CPU-bound TypeScript that parses markdown files line-by-line with regex (`scanMarkdown`), invokes `markdown-it` per list item (`parseTokens`), and extracts YAML frontmatter with `js-yaml` (`parseFrontmatter`). On mobile (Obsidian iOS/Android), where the JS engine is significantly slower than desktop V8/JSC, full-vault indexing is noticeably slow. The hot path involves N YAML parses, N full-file regex scans, and M markdown-it inline parses (plus `parseTokens` calls for canvas text lines and frontmatter parent strings) — all single-threaded. Moving parsing to Rust/WASM provides major speedup while maintaining the `@mdtree/core` I/O-free constraint.

## Scope

- A new `packages/parser-native/` workspace package with Rust source and WASM build tooling
- Rust implementation of full YAML frontmatter extraction (all key-value pairs, since `parentRelation` is user-configurable)
- Rust implementation of `scanMarkdown` (header/list detection, indent tracking, tags, tasks, parent wiring)
- Rust implementation of `parseTokens` (obsidian links, markdown links, images, HTTP URLs, text decorations, meta-action/meta-mdtree extraction)
- TypeScript adapter deserializing WASM output into `@mdtree/core` types
- `ParserProvider` interface in core with: (a) chunked batch file parsing that **pre-computes inline tokens** for all `DvList.rawText` fields and frontmatter parent strings within the same WASM call, (b) standalone `parseTokens(text)` for canvas and other non-batch call sites, (c) single-file `parseVaultFile` (also pre-computes inline tokens)
- Batch output extends `DvPage` with a `parsedTokensByLine` map (keyed by list-item line number) containing pre-computed `ParsedTextToken[]` for each list item, plus a `parsedParentTokens` array for frontmatter parent strings — eliminating per-item WASM boundary crossings during graph construction
- Chunked batch API (50-100 files/chunk) with event-loop yielding between chunks
- Integration points covering `parseVaultFile`, `buildGraphFromScanner`, `buildNodesFromTextLines`, and `indexSinglePage`
- Transparent fallback to TypeScript parser on WASM load failure
- Benchmark harness and CI for WASM builds

## Non-goals

- Replacing graph construction logic (`NotesGraph`, `indexSinglePage` graph mutations)
- Replacing the search layer (`searchIndex`, `advancedSearch`)
- Moving I/O to Rust — file reading stays behind `VaultScanner`
- Native (non-WASM) builds for the plugin
- Rust implementation of CLI SQLite persistence
- Canvas file parsing logic in Rust (only inline token parsing within canvas text lines is accelerated)
- Changing the public API shape of `@mdtree/core` for existing consumers

## Acceptance criteria

- `packages/parser-native/` builds a `.wasm` artifact from Rust source
- WASM parser produces structurally identical output (deep equality) to TS parser for all existing integration test fixtures
- All existing tests pass with native parser active, and all pass with fallback to TS parser
- Plugin bundle includes and loads the WASM artifact at runtime
- Plugin loads and indexes on Obsidian mobile (iOS 16+, Android WebView 91+) via inline WASM
- Parse-phase-only indexing of a 2,000-note vault is at least 3x faster with WASM vs TS
- Incremental single-file reindex shows at least 2x parse-phase speedup
- Batch API processes files in chunks (50-100 per WASM call), yielding between chunks
- **Batch API output includes pre-computed `ParsedTextToken[]` for every `DvList.rawText` and every frontmatter parent string, so `indexSinglePage` uses pre-computed tokens and does NOT make individual `parseTokens` WASM calls per list item**
- **For a 2,000-note vault with ~40,000 list items, graph construction after batch parse makes zero additional WASM boundary crossings for inline token parsing of markdown files**
- WASM compressed size under 2 MB
- `@mdtree/core` remains I/O-free; WASM loading injected by consumers
- `ParserProvider` exposes standalone `parseTokens(text)` usable by `buildNodesFromTextLines` (canvas) and any ad-hoc call sites outside the batch flow
- Rust `parseTokens` produces identical `ParsedTextToken[]` for all fixture `rawText` values
- Rust frontmatter parser emits all YAML key-value pairs (not just hardcoded fields)
- Canvas files with obsidian links in text nodes produce identical graph structures whether using native or TS parser
- Frontmatter parent strings containing obsidian links produce identical graph edges whether using native or TS parser
- Chunk size is configurable per consumer (default 50 for plugin, configurable for CLI) and event-loop yielding occurs between chunks
- `parseCanvasData` accepts and uses the `parseTokensFn` from the provider, threading it through to `buildNodesFromTextLines`
- Core uses strategy pattern — `ParserProvider` is injected as parameter, not loaded via conditional `import()`; TS fallback is default when no provider passed
- On desktop (Bun CLI), full-vault indexing with WASM parser is not slower than TS parser
- Graceful fallback on WASM load failure — console warning, no crash
- Rust source has its own independent test suite

## Planned slice sequence

- `rust-parser-01-scaffold` — Create `packages/parser-native/` with Cargo workspace, wasm-pack config, minimal Rust lib, TS wrapper for WASM loading, and `ParserProvider` interface definition in `@mdtree/core` (including `BatchParsedPage` type that carries pre-computed token maps)
- `rust-parser-02-frontmatter` — Implement full YAML frontmatter extraction in Rust (all key-value pairs) with TS adapter returning `Frontmatter`
- `rust-parser-03-list-scanner` — Implement `scanMarkdown` in Rust (headers, list items, indent stack, tags, tasks, parent wiring, sections) returning `DvList[]` and `HeadingCache[]`
- `rust-parser-04-inline-tokens` — Implement `parseTokens` in Rust (obsidian links, markdown links, images, HTTP URLs, text decorations, meta-action/meta-mdtree) exposed as both batch-internal and standalone callable
- `rust-parser-05-batch-api` — Add chunked batch endpoint that internally calls frontmatter + list-scanner + inline-tokens for every `rawText` and every frontmatter parent string, returning `BatchParsedPage[]` with pre-computed `parsedTokensByLine` maps and `parsedParentTokens`; event-loop yielding between chunks on the TS side
- `rust-parser-06-core-integration` — Wire `@mdtree/core` to accept externally-injected `ParserProvider`; modify `indexSinglePage` to accept pre-computed tokens (lookup from `parsedTokensByLine` at lines 53 and 238 instead of calling `parseTokens`); thread standalone `parseTokensFn` into `parseCanvasData` → `buildNodesFromTextLines` for canvas; transparent TS fallback
- `rust-parser-07-plugin-bundle` — Configure esbuild with inline WASM loader (base64 for mobile, CJS-compatible), add loading + `ParserProvider` instantiation in plugin `onload`, verify mobile
- `rust-parser-08-benchmarks` — Benchmark harness with synthetic vaults, measure parse-phase-only AND full indexing (including graph construction) performance, confirm zero additional WASM crossings per list item during batch flow
- `rust-parser-09-ci-build` — CI workflow for WASM build, Rust tests, and full TS test suite with WASM active