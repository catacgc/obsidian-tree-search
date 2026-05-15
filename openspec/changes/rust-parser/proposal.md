# Rust-Based Indexing Parser

## Why

The current indexing pipeline is CPU-bound TypeScript that parses markdown files line-by-line with regex (`scanMarkdown`), invokes `markdown-it` per list item (`parseTokens`), and extracts YAML frontmatter with `js-yaml` (`parseFrontmatter`). On mobile (Obsidian iOS/Android), where the JavaScript engine is significantly slower than desktop V8/JSC, full-vault indexing is noticeably slow compared to the previous Dataview-based approach.

The hot path for a vault with N files and M total list items:
- `parseFrontmatter` called N times (js-yaml YAML parsing)
- `scanMarkdown` called N times (line-by-line regex scanning over all content)
- `parseTokens` called M times (markdown-it `parseInline` per list item)

For a 5,000-note vault with ~20 list items per note, this is 5,000 YAML parses, 5,000 full-file regex scans, and ~100,000 markdown-it inline parses — all in single-threaded JavaScript.

Moving the parsing layer to Rust compiled to WebAssembly provides 10-50x speedup for regex and string processing, runs on all platforms (desktop Electron, mobile WebView, Bun CLI), and maintains the existing `@mdtree/core` I/O-free constraint.

## Scope

- A new `packages/parser-native/` workspace package containing Rust source and WASM build tooling
- Rust implementation of frontmatter extraction (YAML boundary detection + parsing)
- Rust implementation of `scanMarkdown` (list item detection, header detection, indent tracking, tag extraction, task detection, parent wiring)
- Rust implementation of inline token parsing (`parseTokens` — obsidian links, markdown links, images, text with decorations, meta-action extraction)
- A TypeScript adapter in `packages/parser-native/` that deserializes WASM output into existing `@mdtree/core` types (`DvList[]`, `HeadingCache[]`, `ParsedTextToken[]`, `Frontmatter`)
- A "batch parse" API that accepts multiple file contents and returns all parsed results in a single WASM call (amortizing crossing overhead)
- Integration point in `@mdtree/core` that uses the native parser when available, falling back to the existing TypeScript parser
- A benchmark harness comparing TS vs WASM parser performance on realistic vault data
- CI integration for building the WASM artifact

## Non-goals

- Replacing the graph construction logic (`NotesGraph`, `indexSinglePage`) — graph operations are Map-based JS object manipulation best left in TypeScript
- Replacing the search layer (`searchIndex`, `advancedSearch`) — operates on the already-built in-memory graph
- Moving I/O to Rust — file reading stays behind the `VaultScanner` interface
- Native binary (non-WASM) builds for the Obsidian plugin — WASM is the only portable target for plugin distribution
- Changing the public API of `@mdtree/core` — the parser swap must be transparent to consumers
- Rust implementation of the CLI's SQLite persistence layer
- Performance optimization of the graph builder's batching/yielding logic (orthogonal concern)

## Acceptance criteria

- `packages/parser-native/` builds a `.wasm` artifact from Rust source using `wasm-pack` (or equivalent)
- The WASM parser produces byte-equivalent output to the TypeScript parser for all existing test fixtures in `packages/core/src/__tests__/integration/fixtures/`
- All existing tests pass (`bun run mdtree:test`) with the native parser active
- All existing tests pass with the native parser unavailable (fallback to TS parser)
- `bun run build` produces a plugin bundle that includes the WASM artifact and loads it at runtime
- The plugin loads and indexes successfully on Obsidian mobile (no crash, no missing results)
- Full-vault indexing of a 2,000-note vault is at least 3x faster with WASM parser vs TS parser (measured by benchmark harness)
- Incremental single-file reindex shows measurable improvement (at least 2x for the parse phase)
- The batch API processes multiple files in a single WASM boundary crossing, returning structured results for all files
- The WASM module size is under 2 MB (compressed) to avoid bloating the plugin distribution
- The `@mdtree/core` package remains I/O-free and does not import any platform-specific modules
- The Rust source has its own test suite validating parser correctness independently of the TypeScript tests

## Planned slice sequence

- `rust-parser-01-scaffold` — Create `packages/parser-native/` with Cargo workspace, wasm-pack config, minimal Rust lib that exports a "hello" function, and TypeScript wrapper that loads the WASM module
- `rust-parser-02-frontmatter` — Implement frontmatter extraction in Rust (YAML boundary detection, key-value parsing for aliases/tags/parent fields) with TypeScript adapter returning `Frontmatter` type
- `rust-parser-03-list-scanner` — Implement `scanMarkdown` equivalent in Rust (line iteration, header regex, list-item regex, indent stack, tag extraction, task detection, parent wiring, section tracking) returning serialized `DvList[]` and `HeadingCache[]`
- `rust-parser-04-inline-tokens` — Implement `parseTokens` equivalent in Rust (obsidian `[[link]]` parsing, markdown link/image detection, text decoration spans, meta-action/meta-mdtree extraction) returning serialized `ParsedTextToken[]`
- `rust-parser-05-batch-api` — Add batch endpoint that accepts multiple `(filePath, content, mtime, archiveTag)` tuples and returns all parsed `DvPage` structures in a single WASM call, minimizing boundary-crossing overhead
- `rust-parser-06-core-integration` — Wire `@mdtree/core` parser modules to detect and use native parser: conditional import in `vault-file.ts` and `inline-tokens.ts`, transparent fallback to TS implementations
- `rust-parser-07-plugin-bundle` — Configure esbuild to include the WASM artifact in the plugin build, add WASM loading logic to the Obsidian plugin entry point, verify mobile load
- `rust-parser-08-benchmarks` — Create benchmark harness with realistic vault fixtures (1k and 5k note synthetic vaults), measure and document TS vs WASM parse times for full index and single-file reindex
- `rust-parser-09-ci-build` — Add CI workflow to build the WASM artifact, run Rust tests, and run the full TypeScript test suite with WASM parser active

## Constraints

- The Rust parser must produce structurally identical output to the TypeScript parser — same fields, same values, same edge cases (the existing TypeScript test suite is the contract)
- WASM module must be loadable synchronously or via async init in both Obsidian (browser-like) and Bun (Node-like) environments
- The `packages/core/` hard boundary remains: no I/O, no `bun:*`, no `node:fs` — WASM loading must be injected from outside or handled at the consumer level
- Serialization format between Rust and TypeScript must be efficient (consider direct memory access or MessagePack rather than JSON for large batch results)
- The existing TypeScript parser must remain as a working fallback — it is not deleted
