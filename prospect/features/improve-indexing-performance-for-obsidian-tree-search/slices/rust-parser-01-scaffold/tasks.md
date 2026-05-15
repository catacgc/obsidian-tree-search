# Tasks: rust-parser-01-scaffold

## Task 1 — Create `packages/parser-native/` Rust project structure

Create the following files:

- `packages/parser-native/Cargo.toml` — Configure as a `cdylib` crate named `parser_native`. Dependencies: `wasm-bindgen = "0.2"`, `serde = { version = "1", features = ["derive"] }`, `serde_json = "1"`. Include `[profile.release]` with `opt-level = "z"` and `lto = true` for size optimization.
- `packages/parser-native/rust-toolchain.toml` — Pin to `stable` channel (e.g., `channel = "stable"`).
- `packages/parser-native/src/lib.rs` — A minimal Rust source file with a single `#[wasm_bindgen]` exported function: `pub fn ping() -> String { "pong".to_string() }`. Include the `wasm_bindgen` import.

**Verification:** `cargo check` in `packages/parser-native/` succeeds without errors.

---

## Task 2 — Create `packages/parser-native/` TypeScript package configuration

Create the following files:

- `packages/parser-native/package.json` — Name: `@mdtree/parser-native`, version `0.1.0`, type `module`. Add exports field: `{ ".": "./ts/index.ts" }`. Dependencies: `@mdtree/core: "workspace:*"`. DevDependencies: `typescript: "^5.8.3"`. Scripts: `"build:wasm": "wasm-pack build --target web --out-dir pkg"`, `"test": "bun test"`.
- `packages/parser-native/tsconfig.json` — Matching the style of `packages/core/tsconfig.json`: target ES2022, module ESNext, moduleResolution bundler, strict true, verbatimModuleSyntax true, allowImportingTsExtensions true, noEmit true, lib ES2022.
- `packages/parser-native/.gitignore` — Ignore `pkg/` (wasm-pack output) and `target/` (Cargo build artifacts).

**Verification:** `bun install` at root resolves `@mdtree/parser-native` as a workspace package without errors.

---

## Task 3 — Implement WASM loader TypeScript module

Create `packages/parser-native/ts/loader.ts`:

- Export an async function `loadWasm(wasmBytes: BufferSource): Promise<WasmExports>` where `WasmExports` is a type containing `{ ping: () => string }` (matching the Rust export).
- Implementation: call `WebAssembly.instantiate(wasmBytes, imports)` where `imports` come from the wasm-bindgen glue, OR use the wasm-pack-generated init function from `../pkg/parser_native.js` passing the bytes.
- For this scaffold slice, the simplest approach is: import the wasm-pack-generated `init` function and `ping` from `../pkg/parser_native.js`, export a `loadWasm` that calls `init(wasmBytes)` then returns `{ ping }`.

Create `packages/parser-native/ts/index.ts`:

- Re-export `loadWasm` from `./loader.ts`.
- Export a type `NativeParserHandle` (placeholder for now — just `{ ping: () => string }`).
- Export an async function `loadNativeParser(wasmBytes: BufferSource): Promise<NativeParserHandle>` that calls `loadWasm(wasmBytes)` and returns the handle.

**Verification:** TypeScript type-checks without errors (`bunx tsc --noEmit` in `packages/parser-native/`).

---

## Task 4 — Define `ParserProvider` interface and `FileInput` type in `@mdtree/core`

Create `packages/core/src/parser/parser-provider.ts`:

```typescript
import type { DvPage, ParsedTextToken } from "../graph/types.ts"

export type FileInput = {
  path: string
  content: string
  mtime: number
  archiveTag: string
}

export interface ParserProvider {
  /** Parse a chunk of markdown files in one batch call. */
  parseBatchChunk(files: FileInput[]): DvPage[]

  /** Parse inline tokens from a text string (standalone, for canvas/frontmatter-parent). */
  parseTokens(text: string): ParsedTextToken[]

  /** Parse a single vault file (for incremental reindex). */
  parseVaultFile(content: string, filePath: string, mtime: number, archiveTag: string): DvPage
}
```

**Verification:** File exists, imports resolve, `bunx tsc --noEmit` in `packages/core/` passes.

---

## Task 5 — Implement `TsParserProvider` class

In the same file `packages/core/src/parser/parser-provider.ts`, add:

- Import `parseVaultFile` from `./vault-file.ts` (rename imported symbol to avoid clash with interface method name, e.g., `import { parseVaultFile as tsParseVaultFile }`).
- Import `parseTokens` from `./inline-tokens.ts` (e.g., `import { parseTokens as tsParseTokens }`).
- Implement `TsParserProvider` class implementing `ParserProvider`:
  - `parseBatchChunk(files)`: iterate `files`, call `tsParseVaultFile(f.content, f.path, f.mtime, f.archiveTag)` for each, return the array of `DvPage`.
  - `parseTokens(text)`: return `tsParseTokens(text)`.
  - `parseVaultFile(content, filePath, mtime, archiveTag)`: return `tsParseVaultFile(content, filePath, mtime, archiveTag)`.
- Export a factory function: `export function createTsParserProvider(): ParserProvider { return new TsParserProvider() }`.

**Verification:** `bunx tsc --noEmit` in `packages/core/` passes.

---

## Task 6 — Export new types from `@mdtree/core/index.ts`

Modify `packages/core/src/index.ts`:

- Add exports: `export type { ParserProvider, FileInput } from "./parser/parser-provider.ts"`
- Add exports: `export { TsParserProvider, createTsParserProvider } from "./parser/parser-provider.ts"`

**Verification:** Importing `{ ParserProvider, TsParserProvider, createTsParserProvider, FileInput }` from `@mdtree/core` resolves correctly. All existing tests pass (`bun test packages/core`).

---

## Task 7 — Write tests

**Test A:** Create `packages/core/src/__tests__/parser-provider.test.ts`:

- Test that `createTsParserProvider().parseTokens("[[Link]]")` returns the same result as directly calling `parseTokens("[[Link]]")` from `inline-tokens.ts`.
- Test that `createTsParserProvider().parseVaultFile(content, path, mtime, "archive")` returns the same `DvPage` as directly calling `parseVaultFile(content, path, mtime, "archive")` from `vault-file.ts` — use a simple markdown string with frontmatter and a list item.
- Test that `createTsParserProvider().parseBatchChunk([...])` with two file inputs returns two `DvPage` objects matching individual `parseVaultFile` calls.

**Test B:** Create `packages/parser-native/ts/__tests__/loader.test.ts`:

- Build the WASM first (test setup or pre-built fixture).
- Load the `.wasm` bytes from `../pkg/parser_native_bg.wasm` using `Bun.file().arrayBuffer()`.
- Call `loadNativeParser(bytes)` and assert `handle.ping()` returns `"pong"`.
- (This test requires `wasm-pack build` to have been run first; note this in a comment.)

**Verification:** `bun test packages/core/src/__tests__/parser-provider.test.ts` passes. `bun test packages/parser-native/ts/__tests__/loader.test.ts` passes after `wasm-pack build`.
