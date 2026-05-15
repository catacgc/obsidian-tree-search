# Slice Proposal: rust-parser-01-scaffold

## Problem & Outcome

**Problem:** The project needs a Rust/WASM parser to accelerate indexing on mobile, but no Rust infrastructure exists. No `packages/parser-native/` directory, no Cargo workspace, no WASM build tooling, no `ParserProvider` interface in `@mdtree/core`, and no TypeScript adapter for loading WASM modules. All subsequent parser slices (frontmatter, list-scanner, inline-tokens, batch API, core integration) depend on this scaffolding being in place.

**Outcome:** After this slice, `packages/parser-native/` exists as a workspace package with a working Rust → WASM build pipeline (Cargo.toml, wasm-pack, rust-toolchain), a trivial Rust function exported via `wasm-bindgen`, and a TypeScript wrapper that can load and call that function. Additionally, the `ParserProvider` interface is defined in `@mdtree/core` (with a working `TsParserProvider` implementation wrapping existing TS functions) and exported from `@mdtree/core/index.ts`. This establishes the foundation for all subsequent Rust parser slices.

## What Changes

1. A new `packages/parser-native/` workspace package with:
   - `Cargo.toml` configured as a `cdylib` crate with `wasm-bindgen` and `serde`/`serde_json` dependencies
   - `rust-toolchain.toml` pinning a stable Rust version
   - `src/lib.rs` exporting a trivial `wasm-bindgen` function (e.g., `ping() -> String`)
   - `ts/loader.ts` — TypeScript WASM module instantiation utility
   - `ts/index.ts` — public API exporting `loadNativeParser()`
   - `package.json` for `@mdtree/parser-native` workspace package
   - `tsconfig.json` for the TypeScript layer
   - Build script/instructions for `wasm-pack build --target web`

2. In `packages/core/src/parser/`:
   - New file `parser-provider.ts` defining the `ParserProvider` interface and `TsParserProvider` class
   - `TsParserProvider` implements the interface by delegating to existing `parseVaultFile`, `parseTokens`, and (trivial) `parseBatchChunk` using the existing TS functions

3. In `packages/core/src/index.ts`:
   - Re-export `ParserProvider` type, `TsParserProvider`, and `createTsParserProvider()` factory

4. Root `package.json` workspace array includes `packages/parser-native` (already covered by `"packages/*"` glob)

## Scope

**In-scope:**
- Cargo workspace setup with `wasm-bindgen`, `serde`, `serde_json` dependencies
- `rust-toolchain.toml` pinning stable Rust
- Minimal `src/lib.rs` with a trivial exported function proving the WASM pipeline works
- TypeScript loader (`ts/loader.ts`) that instantiates WASM from a `BufferSource`
- TypeScript public API (`ts/index.ts`) with `loadNativeParser()` returning a handle
- `@mdtree/parser-native` package.json with workspace reference to `@mdtree/core`
- `ParserProvider` interface in `@mdtree/core` with `parseBatchChunk`, `parseTokens`, and `parseVaultFile` methods
- `TsParserProvider` implementing the interface using existing TS parser functions
- Export of `ParserProvider`, `TsParserProvider`, `createTsParserProvider`, and `FileInput` type from `@mdtree/core`
- Basic test verifying `TsParserProvider` delegates correctly
- Basic test verifying the WASM module loads and the trivial function returns expected output

**Non-goals (explicitly excluded):**
- Implementing real parsing logic in Rust (frontmatter, list-scanner, inline-tokens)
- Batch API chunking or yielding logic
- Modifying `builder.ts`, `indexer.ts`, `text-lines.ts`, or `canvas.ts`
- Plugin esbuild integration or WASM inlining
- Benchmark harness
- CI workflow for Rust builds

## Acceptance Criteria

1. Running `wasm-pack build --target web` in `packages/parser-native/` produces a `.wasm` file and JS glue code without errors.
2. The produced `.wasm` file is under 100 KB (trivial function only).
3. A TypeScript test in `packages/parser-native/ts/__tests__/` loads the WASM module via `loader.ts` and calls the trivial function, receiving the expected return value.
4. `packages/parser-native/package.json` is a valid workspace member (resolved by Bun workspaces via the existing `"packages/*"` glob).
5. `ParserProvider` interface is defined in `packages/core/src/parser/parser-provider.ts` with three methods: `parseBatchChunk(files: FileInput[]): DvPage[]`, `parseTokens(text: string): ParsedTextToken[]`, and `parseVaultFile(content: string, filePath: string, mtime: number, archiveTag: string): DvPage`.
6. `TsParserProvider` class implements `ParserProvider` by delegating to the existing `parseVaultFile` from `vault-file.ts` and `parseTokens` from `inline-tokens.ts`.
7. `TsParserProvider.parseBatchChunk()` calls `parseVaultFile` per file and returns the resulting `DvPage[]`.
8. `createTsParserProvider()` factory function returns a `TsParserProvider` instance.
9. `ParserProvider`, `TsParserProvider`, `createTsParserProvider`, and `FileInput` are exported from `packages/core/src/index.ts`.
10. Running `bun test packages/core` passes all existing tests (no regressions).
11. A new test in `packages/core/src/__tests__/` verifies that `TsParserProvider.parseTokens("[[Link]]")` returns the same result as calling `parseTokens("[[Link]]")` directly.
12. A new test verifies `TsParserProvider.parseVaultFile(content, path, mtime, archiveTag)` returns the same `DvPage` as calling `parseVaultFile` directly.
13. The `FileInput` type is defined with fields: `path: string`, `content: string`, `mtime: number`, `archiveTag: string`.

## Feature Mapping

- **Source feature:** Improve indexing performance for obsidian-tree-search (Rust WASM parser)
- **Slice item:** `rust-parser-01-scaffold`
