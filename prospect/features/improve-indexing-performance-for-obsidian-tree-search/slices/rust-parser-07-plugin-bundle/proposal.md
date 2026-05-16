# Slice Proposal: rust-parser-07-plugin-bundle

## Problem & Outcome

**Problem:** Slices 01-06 built the complete Rust WASM parser, the `ParserProvider` interface, the `NativeParserProvider` class, and wired `@mdtree/core`'s graph-building pipeline to accept and use a provider. However, the Obsidian plugin (`src/main.ts`) still creates an `IndexedTree` without any parser provider, meaning all indexing still goes through the TypeScript fallback path. The WASM binary exists at `packages/parser-native/pkg/parser_native_bg.wasm` but is not bundled into the plugin output, not loaded at runtime, and not connected to the `IndexedTree`. On mobile, where WASM performance gains matter most, there is no mechanism to load the WASM since filesystem access is not available — the binary must be embedded inline in the JavaScript bundle.

**Outcome:** After this slice, the built Obsidian plugin (`dist/main.js`) embeds the WASM binary as a base64-encoded string via an esbuild plugin. On `onload()`, the plugin decodes and instantiates the WASM module, creates a `NativeParserProvider`, and passes it to `IndexedTree`. If WASM loading fails (e.g., unsupported platform, corrupted binary), the plugin gracefully falls back to `TsParserProvider` with a console warning — no user-visible error or crash. The `IndexedTree` passes the provider through to `buildGraphFromScanner` and `reindexFileInGraph`, enabling the full native batch parsing pipeline at runtime.

## What Changes

1. **Custom esbuild plugin for WASM inlining** (`esbuild.config.mjs`): A new esbuild plugin that intercepts imports of `.wasm` files and replaces them with a module exporting a base64 string constant. This allows the WASM binary to be embedded directly in the CJS output bundle without filesystem access at runtime.

2. **WASM bytes module** (`src/wasm/parser-native-wasm.ts`): A small module that imports the `.wasm` file (resolved by the esbuild plugin) and exports the raw bytes as a `Uint8Array` (decoded from base64 at import time).

3. **Parser provider factory** (`src/indexing/load-native-parser.ts`): An async function that attempts to load the WASM module using `loadNativeParser` from `@mdtree/parser-native`, then wraps it in a `NativeParserProvider`. Returns `null` on failure (catch-all error handling with `console.warn`).

4. **`IndexedTree` modification** (`src/indexing/indexed-tree.ts`): The constructor or a setter accepts an optional `ParserProvider`. `refresh()` passes it as the third argument to `buildGraphFromScanner`. `refreshPage()` passes it as the fifth argument to `reindexFileInGraph`.

5. **Plugin `onload()` modification** (`src/main.ts`): After settings are loaded, attempts to load the native parser. On success, injects the `NativeParserProvider` into `IndexedTree`. On failure, logs a warning and continues (TS fallback is automatic since `IndexedTree` works without a provider).

6. **`@mdtree/parser-native` added to root `package.json` dependencies**: The plugin source imports from `@mdtree/parser-native`, so it must be declared as a workspace dependency.

## Scope

**In-scope:**
- Adding a custom esbuild plugin to inline `.wasm` as base64
- Creating a WASM bytes module that decodes the base64 to `Uint8Array`
- Creating an async factory function for native parser loading with try/catch fallback
- Modifying `IndexedTree` to accept and use an optional `ParserProvider`
- Modifying `TreeSearchPlugin.onload()` to load WASM and inject the provider
- Adding `@mdtree/parser-native` as a workspace dependency in root `package.json`
- Verifying the build succeeds and produces a valid `dist/main.js` with embedded WASM

**Non-goals (explicitly excluded):**
- Modifying `@mdtree/core` — already complete (slice 06)
- Modifying `@mdtree/parser-native` — already complete (slices 01-05)
- CLI integration — not part of this slice (could be a future enhancement)
- Benchmarking — slice 08
- CI workflow — slice 09
- Mobile-specific testing infrastructure — verification is manual for this slice
- Compressing WASM before base64 encoding — optimization deferred (raw base64 is acceptable given WASM is under 2MB and Obsidian distributes plugins as gzipped archives)

## Acceptance Criteria

1. `esbuild.config.mjs` contains a custom plugin that resolves `.wasm` file imports to inline base64 string modules.
2. Running `node esbuild.config.mjs production` produces `dist/main.js` that contains the WASM binary as an embedded base64 string (no external `.wasm` file in `dist/`).
3. `src/indexing/load-native-parser.ts` exports an async function that returns a `ParserProvider` (the `NativeParserProvider` wrapping the loaded WASM) or `null` on failure.
4. If WASM instantiation fails (e.g., `WebAssembly` unavailable, malformed bytes), the factory function catches the error, calls `console.warn` with an informative message, and returns `null` — no exception propagates.
5. `IndexedTree` accepts an optional `ParserProvider` (via constructor parameter or setter method) and passes it to `buildGraphFromScanner` and `reindexFileInGraph`.
6. `TreeSearchPlugin.onload()` calls the native parser factory function and, on success, sets the provider on `IndexedTree` before the initial `refresh()`.
7. If the native parser factory returns `null`, the plugin continues without error — `IndexedTree` operates in fallback mode (no provider, existing TS path).
8. The root `package.json` lists `@mdtree/parser-native` in `dependencies`.
9. `dist/main.js` is loadable as a valid Obsidian plugin (CJS module exporting a default class extending `Plugin`).
10. The WASM inlining esbuild plugin handles the import path `packages/parser-native/pkg/parser_native_bg.wasm` correctly within the bundler resolution context.
11. No new runtime dependencies are added beyond the workspace packages.
12. TypeScript type-checking passes (`tsc -noEmit -skipLibCheck`).

## Feature Mapping

- **Source feature:** Improve indexing performance for obsidian-tree-search (Rust WASM parser)
- **Slice item:** `rust-parser-07-plugin-bundle`
