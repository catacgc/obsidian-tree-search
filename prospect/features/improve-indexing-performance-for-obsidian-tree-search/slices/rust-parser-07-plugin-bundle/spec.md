# Behavioral Spec: rust-parser-07-plugin-bundle

## ADDED Requirements

### Requirement: The plugin bundle MUST embed the WASM binary inline as base64

The esbuild build pipeline SHALL produce a single `dist/main.js` file that contains the parser-native WASM binary encoded as a base64 string. No external `.wasm` files SHALL be required at runtime.

#### Scenario: Production build embeds WASM

- **Given** the esbuild config contains a WASM inline plugin
- **When** `node esbuild.config.mjs production` is executed
- **Then** `dist/main.js` is produced containing a base64-encoded string representing the WASM binary
- **And** no `.wasm` file exists in the `dist/` directory

#### Scenario: Base64 decodes to valid WASM module

- **Given** the base64 string embedded in the bundle
- **When** the string is decoded to bytes and passed to `WebAssembly.instantiate`
- **Then** a valid WASM instance is created with the expected exported functions (`ping`, `batch_parse_chunk`, `parse_single_file`, `parse_tokens`)

---

### Requirement: The plugin MUST attempt to load the native WASM parser on startup

The `TreeSearchPlugin.onload()` method SHALL call the native parser loader function before the initial graph refresh. If loading succeeds, the `NativeParserProvider` SHALL be injected into `IndexedTree` so that `buildGraphFromScanner` and `reindexFileInGraph` use the native batch parsing path.

#### Scenario: Successful WASM load on startup

- **Given** the plugin is loaded in an environment that supports `WebAssembly`
- **When** `onload()` is called
- **Then** the WASM module is instantiated from the embedded bytes
- **And** a `NativeParserProvider` is created and set on `IndexedTree`
- **And** a debug message `"[mdtree] Native WASM parser loaded successfully"` is logged to console
- **And** the subsequent `refresh()` call uses the native provider for batch parsing

#### Scenario: First graph refresh uses native parser

- **Given** WASM loading succeeded and the provider is set on `IndexedTree`
- **When** `IndexedTree.refresh()` is called
- **Then** `buildGraphFromScanner` receives the `NativeParserProvider` as its third argument
- **And** `.md` files are processed via `parseBatchChunk` (the batch path in builder.ts)

---

### Requirement: The plugin MUST gracefully fall back to the TypeScript parser if WASM loading fails

If WASM instantiation fails for any reason (unsupported environment, corrupted binary, memory limit), the plugin SHALL NOT crash or display a user-visible error. It SHALL log a warning and continue with the TypeScript parser fallback.

#### Scenario: WASM unavailable — graceful fallback

- **Given** the runtime environment does not support `WebAssembly` or WASM instantiation throws
- **When** `onload()` attempts to load the native parser
- **Then** the error is caught and a warning `"[mdtree] Failed to load native WASM parser, falling back to TypeScript parser:"` followed by the error is logged via `console.warn`
- **And** the loader function returns `null`
- **And** `IndexedTree` has no provider set (remains `undefined`)
- **And** `buildGraphFromScanner` operates in its fallback path (file-by-file TS parsing)
- **And** the plugin continues to function normally

#### Scenario: Malformed WASM bytes — no crash

- **Given** the base64-encoded WASM string is somehow corrupted
- **When** `loadNativeParserProvider()` is called
- **Then** `WebAssembly.instantiate` throws an error
- **And** the catch block logs the error and returns `null`
- **And** the plugin proceeds with TypeScript parsing

---

### Requirement: `IndexedTree` MUST thread the parser provider to core graph-building functions

When a `ParserProvider` is set on `IndexedTree`, it SHALL be passed to both `buildGraphFromScanner` (for full refreshes) and `reindexFileInGraph` (for single-file incremental updates).

#### Scenario: Full refresh passes provider

- **Given** a `ParserProvider` is set on `IndexedTree` via `setParserProvider()`
- **When** `refresh()` is called
- **Then** `buildGraphFromScanner(scanner, settings, provider)` is called with the provider as the third argument

#### Scenario: Single-page reindex passes provider

- **Given** a `ParserProvider` is set on `IndexedTree` via `setParserProvider()`
- **When** `refreshPage(file)` is called
- **Then** `reindexFileInGraph(path, graph, scanner, settings, provider)` is called with the provider as the fifth argument

#### Scenario: No provider set — unchanged behavior

- **Given** no `ParserProvider` has been set on `IndexedTree`
- **When** `refresh()` or `refreshPage()` is called
- **Then** `buildGraphFromScanner` and `reindexFileInGraph` receive `undefined` for the provider argument
- **And** they operate in their existing fallback mode (file-by-file TS parsing)

---

### Requirement: The esbuild WASM inline plugin MUST NOT interfere with existing build functionality

The custom esbuild plugin SHALL only intercept `.wasm` file imports. All other build behavior (TypeScript compilation, CSS processing, file copying, externals) SHALL remain unchanged.

#### Scenario: Existing build features unaffected

- **Given** the WASM inline plugin is registered in esbuild config
- **When** a production build is executed
- **Then** `dist/styles.css` is produced (tailwind CSS processing works)
- **And** `dist/manifest.json` is copied (copyFilesPlugin works)
- **And** external modules (`obsidian`, `electron`, etc.) are not bundled
- **And** the output format remains `cjs`

#### Scenario: Non-WASM imports unaffected

- **Given** the WASM inline plugin is registered
- **When** esbuild resolves imports for `.ts`, `.tsx`, `.css`, or other non-`.wasm` files
- **Then** the WASM plugin does not intercept them (its `onResolve` filter only matches `.wasm`)
