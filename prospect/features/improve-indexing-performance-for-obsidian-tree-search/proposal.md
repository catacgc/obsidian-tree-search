## Why

The current indexing pipeline is CPU-bound TypeScript that parses markdown files line-by-line with regex (`scanMarkdown` in `packages/core/src/parser/list-scanner.ts`), invokes `markdown-it` per list item (`parseTokens` in `packages/core/src/parser/inline-tokens.ts`), and extracts YAML frontmatter with `js-yaml` (`parseFrontmatter` in `packages/core/src/parser/frontmatter.ts`). On mobile (Obsidian iOS/Android), where the JavaScript engine is significantly slower than desktop V8/JSC, full-vault indexing is noticeably slow compared to the previous Dataview-based approach.

The hot path for a vault with N files and M total list items involves N YAML parses, N full-file regex scans, and M markdown-it inline parses — all in single-threaded JavaScript. Moving this parsing layer to Rust compiled to WASM provides major speedup for string processing, runs on all platforms (desktop Electron, mobile WebView, Bun CLI), and maintains the existing `@mdtree/core` I/O-free constraint.

## Scope

- A new `packages/parser-native/` workspace package containing Rust source and WASM build tooling
- Rust implementation of frontmatter extraction (YAML boundary detection + parsing)
- Rust implementation of `scanMarkdown` (list item/header detection, indent tracking, tag extraction, task detection, parent wiring)
- Rust implementation of inline token parsing (`parseTokens` — obsidian links, markdown links, images, text decorations, meta-action extraction)
- TypeScript adapter deserializing WASM output into existing `@mdtree/core` types (`DvList[]`, `HeadingCache[]`, `ParsedTextToken[]`, `Frontmatter`)
- A batch parse API that accepts multiple file contents in a single WASM call
- Integration point in `@mdtree/core` with transparent fallback to the TypeScript parser
- Benchmark harness and CI for WASM builds

## Non-goals

- Replacing graph construction logic (`NotesGraph`, `indexSinglePage`) — JS object manipulation, not string-heavy
- Replacing the search layer (`searchIndex`, `advancedSearch`) — operates on the already-built graph
- Moving I/O to Rust — file reading stays behind `VaultScanner`
- Native (non-WASM) builds for the plugin — WASM is the only portable target
- Changing the public API of `@mdtree/core`
- Rust implementation of CLI SQLite persistence
- Optimizing graph builder batching/yielding (orthogonal)

## Acceptance criteria

- `packages/parser-native/` builds a `.wasm` artifact from Rust source
- WASM parser produces byte-equivalent output to TS parser for all existing integration test fixtures
- All existing tests pass with native parser active, and all pass with fallback to TS parser
- Plugin bundle includes and loads the WASM artifact at runtime
- Plugin loads and indexes successfully on Obsidian mobile
- Full-vault indexing of a 2,000-note vault is at least 3x faster with WASM parser vs TS parser
- Incremental single-file reindex shows at least 2x speedup in the parse phase
- Batch API processes multiple files in a single WASM boundary crossing
- WASM module compressed size is under 2 MB
- `@mdtree/core` remains I/O-free
- Rust source has its own test suite

## Planned slice sequence

- `rust-parser-01-scaffold` — Create `packages/parser-native/` with Cargo workspace, wasm-pack config, minimal Rust lib exporting a trivial function, and TypeScript wrapper that loads the WASM module
- `rust-parser-02-frontmatter` — Implement frontmatter extraction in Rust (YAML boundary detection, key-value parsing for aliases/tags/parent fields) with TypeScript adapter returning `Frontmatter`
- `rust-parser-03-list-scanner` — Implement `scanMarkdown` equivalent in Rust (header/list-item regex, indent stack, tag extraction, task detection, parent wiring, section tracking) returning serialized `DvList[]` and `HeadingCache[]`
- `rust-parser-04-inline-tokens` — Implement `parseTokens` equivalent in Rust (obsidian `[[link]]` parsing, markdown link/image detection, text decoration, meta-action extraction) returning serialized `ParsedTextToken[]`
- `rust-parser-05-batch-api` — Add batch endpoint accepting multiple `(filePath, content, mtime, archiveTag)` tuples, returning all parsed `DvPage` structures in one WASM call
- `rust-parser-06-core-integration` — Wire `@mdtree/core` parser modules to detect and use native parser, with transparent fallback to TS implementations
- `rust-parser-07-plugin-bundle` — Configure esbuild to include WASM artifact, add loading logic in the Obsidian plugin entry point, verify mobile load
- `rust-parser-08-benchmarks` — Create benchmark harness with synthetic vaults (1k/5k notes), measure and document TS vs WASM parse performance
- `rust-parser-09-ci-build` — Add CI workflow for WASM build, Rust tests, and full TypeScript test suite with WASM active