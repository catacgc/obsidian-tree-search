# Spec Delta: rust-parser-01-scaffold

## ADDED Requirements

### Requirement: WASM Build Pipeline

The `packages/parser-native/` package SHALL produce a valid WebAssembly module via `wasm-pack build --target web`.

#### Scenario: Successful WASM build from Rust source

- **Given** the `packages/parser-native/` directory contains a valid `Cargo.toml` with `crate-type = ["cdylib"]` and `wasm-bindgen` dependency
- **When** `wasm-pack build --target web --out-dir pkg` is executed in `packages/parser-native/`
- **Then** a `pkg/parser_native_bg.wasm` file MUST be produced
- **And** a `pkg/parser_native.js` glue module MUST be produced
- **And** the build MUST complete without errors

#### Scenario: Trivial function exported from WASM

- **Given** `src/lib.rs` exports a function `ping` annotated with `#[wasm_bindgen]`
- **When** the WASM module is instantiated with valid bytes via `WebAssembly.instantiate`
- **Then** the `ping` function MUST be callable from JavaScript
- **And** it MUST return the string `"pong"`

---

### Requirement: WASM Loader TypeScript Module

The `packages/parser-native/ts/loader.ts` module SHALL provide a function to load and instantiate WASM modules from raw bytes.

#### Scenario: Loading WASM from ArrayBuffer

- **Given** a valid `.wasm` ArrayBuffer produced by `wasm-pack build`
- **When** `loadNativeParser(wasmBytes)` is called with that buffer
- **Then** it MUST return a `NativeParserHandle` object
- **And** the handle MUST expose a `ping()` method that returns `"pong"`

#### Scenario: Loading fails with invalid bytes

- **Given** an invalid or empty `ArrayBuffer`
- **When** `loadNativeParser(invalidBytes)` is called
- **Then** it MUST throw or reject with an error (not silently return a broken handle)

---

### Requirement: ParserProvider Interface Definition

The `@mdtree/core` package SHALL export a `ParserProvider` interface that defines the contract for parser implementations.

#### Scenario: Interface exposes parseBatchChunk method

- **Given** a `ParserProvider` implementation
- **When** `parseBatchChunk` is called with an array of `FileInput` objects (each containing `path`, `content`, `mtime`, `archiveTag`)
- **Then** it MUST return a `DvPage[]` array with one entry per input file
- **And** each `DvPage` MUST have the same structure as produced by the existing `parseVaultFile` function

#### Scenario: Interface exposes standalone parseTokens method

- **Given** a `ParserProvider` implementation
- **When** `parseTokens(text)` is called with a markdown text string
- **Then** it MUST return a `ParsedTextToken[]` array representing the inline tokens in that text

#### Scenario: Interface exposes parseVaultFile method

- **Given** a `ParserProvider` implementation
- **When** `parseVaultFile(content, filePath, mtime, archiveTag)` is called
- **Then** it MUST return a single `DvPage` object representing the parsed file

---

### Requirement: TsParserProvider Implementation

The `@mdtree/core` package SHALL provide a `TsParserProvider` class that implements `ParserProvider` by delegating to existing TypeScript parser functions.

#### Scenario: TsParserProvider.parseTokens delegates to inline-tokens.ts

- **Given** a `TsParserProvider` instance created via `createTsParserProvider()`
- **When** `provider.parseTokens("[[MyPage]]")` is called
- **Then** the result MUST be identical (deep equal) to calling `parseTokens("[[MyPage]]")` from `packages/core/src/parser/inline-tokens.ts` directly

#### Scenario: TsParserProvider.parseVaultFile delegates to vault-file.ts

- **Given** a `TsParserProvider` instance
- **And** a markdown string `content` with YAML frontmatter and list items
- **When** `provider.parseVaultFile(content, "test.md", 1700000000000, "archive")` is called
- **Then** the result MUST be identical (deep equal) to calling `parseVaultFile(content, "test.md", 1700000000000, "archive")` from `packages/core/src/parser/vault-file.ts` directly

#### Scenario: TsParserProvider.parseBatchChunk processes multiple files

- **Given** a `TsParserProvider` instance
- **And** an array of two `FileInput` objects with different markdown content
- **When** `provider.parseBatchChunk(files)` is called
- **Then** it MUST return an array of exactly 2 `DvPage` objects
- **And** each MUST be identical (deep equal) to calling `parseVaultFile` individually for that file's content, path, mtime, and archiveTag

---

### Requirement: Core Package Exports

The `@mdtree/core` package SHALL export the `ParserProvider` type, `TsParserProvider` class, `createTsParserProvider` factory, and `FileInput` type from its main entry point.

#### Scenario: Importing ParserProvider types from @mdtree/core

- **Given** a TypeScript file that imports from `@mdtree/core`
- **When** it imports `{ ParserProvider, TsParserProvider, createTsParserProvider, FileInput }`
- **Then** all four symbols MUST resolve without TypeScript compilation errors
- **And** `ParserProvider` MUST be a type (interface)
- **And** `TsParserProvider` MUST be a class
- **And** `createTsParserProvider` MUST be a function returning `ParserProvider`
- **And** `FileInput` MUST be a type with fields `path: string`, `content: string`, `mtime: number`, `archiveTag: string`

---

### Requirement: No Regression in Existing Tests

Adding the `ParserProvider` infrastructure to `@mdtree/core` SHALL NOT break any existing functionality.

#### Scenario: All existing core tests pass

- **Given** the `ParserProvider` interface and `TsParserProvider` have been added to `packages/core/`
- **When** `bun test packages/core` is executed
- **Then** all previously passing tests MUST still pass
- **And** no existing file in `packages/core/src/` (other than `index.ts`) is modified

---

### Requirement: Workspace Package Registration

The `packages/parser-native/` package SHALL be recognized as a valid Bun workspace member.

#### Scenario: Bun resolves parser-native workspace package

- **Given** the root `package.json` has `"workspaces": ["packages/*"]`
- **And** `packages/parser-native/package.json` exists with name `@mdtree/parser-native`
- **When** `bun install` is run at the project root
- **Then** `@mdtree/parser-native` MUST be resolvable as a workspace dependency
- **And** no installation errors MUST occur related to the new package
