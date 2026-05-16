# Slice Proposal: rust-parser-07-plugin-bundle

## Problem & Outcome

**Problem:** Slices 01-06 built the complete Rust WASM parser, the `ParserProvider` interface, the `NativeParserProvider` class, and wired `@mdtree/core`'s graph-building pipeline to accept and use a provider. However, the Obsidian plugin (`src/main.ts`) still creates an `IndexedTree` without any parser provider, meaning all indexing still goes through the TypeScript fallback path. The WASM binary exists at `packages/parser-native/pkg/parser_native_bg.wasm` but is not bundled into the plugin output, not loaded at runtime, and not connected to the `IndexedTree`. On mobile, where WASM performance gains matter most, there is no mechanism to load the WASM since filesystem access is not available — the binary must be embedded inline in the JavaScript bundle.

Additionally, the wasm-pack generated glue code (`parser_native.js:341`) contains `new URL('parser_native_bg.wasm', import.meta.url)` which esbuild may statically process as an asset reference and emit a `.wasm` file to the output directory — even though this code path is unreachable at runtime. The build must suppress this behavior.

**Outcome:** After this slice, the built Obsidian plugin (`dist/main.js`) embeds the WASM binary as a base64-encoded string via an esbuild plugin, with no external `.wasm` file in `dist/`. On `onload()`, the plugin decodes and instantiates the WASM module, creates a `NativeParserProvider`, and passes it to `IndexedTree` via a setter method (since WASM loading is async and completes after `IndexedTree` construction). If WASM loading fails (e.g., unsupported platform, corrupted binary), the plugin gracefully falls back to the TS parser path with a console warning — no user-visible error or crash.

## What Changes

1. **Custom esbuild plugin for WASM inlining** (`esbuild.config.mjs`): A new esbuild plugin that intercepts imports of `.wasm` files and replaces them with a module exporting a base64 string constant. Additionally, the esbuild config adds a `loader: { '.wasm': 'empty' }` entry to suppress esbuild's static asset processing of the `new URL('parser_native_bg.wasm', import.meta.url)` pattern in the wasm-pack glue code.

2. **WASM bytes module** (`src/wasm/parser-native-wasm.ts`): A small module that imports the `.wasm` file (resolved by the esbuild plugin to base64) and exports the raw bytes as a `Uint8Array`.

3. **Parser provider factory** (`src/indexing/load-native-parser.ts`): An async function that attempts to load the WASM module and returns a `ParserProvider` or `null` on failure.

4. **`IndexedTree` modification** (`src/indexing/indexed-tree.ts`): Adds a `setParserProvider(provider)` setter method and a private field. The setter approach is used (not constructor injection) because WASM loading is async and completes after `IndexedTree` is constructed at `main.ts:43`. `refresh()` passes the provider as the third argument to `buildGraphFromScanner`. `refreshPage()` passes it as the fifth argument to `reindexFileInGraph`.

5. **Plugin `onload()` modification** (`src/main.ts`): After `IndexedTree` construction and before the first `refresh()`, attempts to load the native parser. On success, injects the `NativeParserProvider` via `setParserProvider()`. On failure, logs a warning and continues.

6. **`@mdtree/parser-native` added to root `package.json` dependencies**.

7. **Build prerequisite documentation**: A `prebuild` script or explicit documentation that `wasm-pack build --target web --out-dir pkg` must run in `packages/parser-native/` before the plugin esbuild can execute, since `pkg/` is gitignored and does not exist on fresh checkout.

## Scope

**In-scope:**
- Adding a custom esbuild plugin to inline `.wasm` as base64
- Adding `loader: { '.wasm': 'empty' }` to esbuild config to suppress the `new URL(...)` asset emission
- Creating a WASM bytes module that decodes base64 to `Uint8Array`
- Creating an async factory function for native parser loading with try/catch fallback
- Modifying `IndexedTree` to accept a `ParserProvider` via setter method and thread it to core functions
- Modifying `TreeSearchPlugin.onload()` to load WASM and inject the provider before first refresh
- Adding `@mdtree/parser-native` as a workspace dependency in root `package.json`
- Adding a `prebuild:wasm` script to root `package.json` (or documenting the build order) so `pkg/` exists before the esbuild plugin runs
- Verifying the build succeeds and produces a valid `dist/main.js` with embedded WASM and no external `.wasm` file

**Non-goals (explicitly excluded):**
- Modifying `@mdtree/core` — already complete (slice 06)
- Modifying `@mdtree/parser-native` Rust or TS source — already complete (slices 01-05)
- CLI integration — not part of this slice
- Benchmarking — slice 08
- CI workflow — slice 09
- Mobile-specific testing infrastructure — verification is manual
- Compressing WASM before base64 encoding
- Removing `pkg/` from `.gitignore` (the committed binary approach) — build scripts handle generation

## Acceptance Criteria

1. `esbuild.config.mjs` contains a custom plugin that resolves `.wasm` file imports to inline base64 string modules.
2. `esbuild.config.mjs` includes `loader: { '.wasm': 'empty' }` (or equivalent mechanism) to prevent esbuild from emitting `.wasm` as an asset when it encounters the `new URL('parser_native_bg.wasm', import.meta.url)` pattern in the bundled glue code.
3. Running `node esbuild.config.mjs production` (after `wasm-pack build`) produces `dist/main.js` with embedded WASM — no external `.wasm` file in `dist/`.
4. `src/indexing/load-native-parser.ts` exports an async function returning `ParserProvider | null`.
5. If WASM instantiation fails, the factory catches the error, calls `console.warn`, and returns `null` — no exception propagates.
6. `IndexedTree` has a `setParserProvider(provider: ParserProvider): void` setter method (not constructor injection, because WASM loads asynchronously after construction).
7. `IndexedTree.refresh()` passes the stored provider as the third argument to `buildGraphFromScanner`.
8. `IndexedTree.refreshPage()` passes the stored provider as the fifth argument to `reindexFileInGraph`.
9. `TreeSearchPlugin.onload()` calls `loadNativeParserProvider()` and sets the provider on `IndexedTree` before the initial `refresh()`.
10. If the native parser factory returns `null`, the plugin continues without error — `IndexedTree` operates in fallback mode.
11. The root `package.json` lists `@mdtree/parser-native` in `dependencies` and has a `prebuild:wasm` script (or equivalent) that runs `wasm-pack build --target web --out-dir pkg` inside `packages/parser-native/`.
12. `dist/main.js` is loadable as a valid CJS Obsidian plugin module.
13. No new runtime dependencies are added beyond workspace packages.
14. `tsc -noEmit -skipLibCheck` passes.

## Feature Mapping

- **Source feature:** Improve indexing performance for obsidian-tree-search (Rust WASM parser)
- **Slice item:** `rust-parser-07-plugin-bundle`
