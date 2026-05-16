### Critical (must fix before archiving)
(none)

### Warnings (should address or explicitly defer)
- [ ] **wasm-pack glue code emits deprecation warning at runtime** — `packages/parser-native/ts/loader.ts:30` passes `wasmBytes` directly to `glue.default(wasmBytes)`, but the wasm-pack 0.12+ glue code at `packages/parser-native/pkg/parser_native.js:333-336` expects the new API `init({ module_or_path: wasmBytes })`. Passing a raw `BufferSource` triggers `console.warn('using deprecated parameters for the initialization function; pass a single object instead')` on every plugin load. While functionally harmless, this pollutes the console on every Obsidian startup. Fix: change to `await glue.default({ module_or_path: wasmBytes })`. Note: this is in `packages/parser-native/ts/loader.ts` which is technically from a prior slice (slice 01), so it may be out of scope for this review.
- [ ] **Potential race condition: interval-triggered refresh can start before WASM is loaded** — `src/main.ts:114-118` registers a `setInterval` that fires every 2000ms and triggers `this.index.refresh()` via the `isGraphLoadingAtom` subscription (line 106-112). The WASM loading at line 160 is async (involves `WebAssembly.instantiate`). On a slow mobile device where WASM instantiation takes >2 seconds, the interval fires first, triggering a refresh WITHOUT the native provider (since `setParserProvider` hasn't been called yet). This means the first indexing uses the TS fallback, and only subsequent refreshes benefit from WASM. The spec's scenario "First graph refresh uses native parser" (spec.md:67-72) may not hold on slow devices. — `src/main.ts:114-118` vs `src/main.ts:160-166`

### Suggestions (consider before or after archiving)
- [ ] **Dead `declare const wasmBase64: string` in WASM bytes module** — `src/wasm/parser-native-wasm.ts:4` declares `wasmBase64` as a string but the actual variable used is `wasmBase64Imported` (line 6). The declare is never referenced and appears to be a leftover from a design iteration. It's confusing because a reader might think it's providing the type for the import, but it doesn't (the `@ts-ignore` + `as unknown as string` pattern does that instead). Consider removing it for clarity. — `src/wasm/parser-native-wasm.ts:4`

### Verified
- [x] AC1: esbuild WASM inline plugin — confirmed at `esbuild.config.mjs:12-28`, `onResolve` with `/\.wasm$/` filter, `onLoad` reads file and returns base64
- [x] AC2: `loader: { '.wasm': 'empty' }` suppresses asset emission — confirmed at `esbuild.config.mjs:87`
- [x] AC3: Production build produces `dist/main.js` with embedded WASM, no `.wasm` in dist — confirmed via `dist/` contents (no `.wasm` file) and `AGFzbQ` base64 magic number present in `dist/main.js`
- [x] AC4: `loadNativeParserProvider` returns `ParserProvider | null` — confirmed at `src/indexing/load-native-parser.ts:13`
- [x] AC5: WASM failure caught with `console.warn` — confirmed at `src/indexing/load-native-parser.ts:19-21`
- [x] AC6: `IndexedTree` has `setParserProvider` setter method — confirmed at `src/indexing/indexed-tree.ts:17-19`
- [x] AC7: `refresh()` passes provider as 3rd arg to `buildGraphFromScanner` — confirmed at `src/indexing/indexed-tree.ts:41`
- [x] AC8: `refreshPage()` passes provider as 5th arg to `reindexFileInGraph` — confirmed at `src/indexing/indexed-tree.ts:61`
- [x] AC9: `onload()` loads WASM and sets provider before `refresh()` — confirmed at `src/main.ts:160-166`
- [x] AC10: If factory returns null, plugin continues — confirmed: no exception propagation, `setParserProvider` only called if non-null (line 161)
- [x] AC11: Root `package.json` has `@mdtree/parser-native` dep and `prebuild:wasm` script — confirmed at `package.json:9,43`
- [x] AC12: `dist/main.js` is valid CJS — esbuild config has `format: "cjs"` at line 75
- [x] AC13: No new runtime dependencies beyond workspace packages — confirmed in `package.json`
- [x] AC14: TypeScript type-checks — implementation summary confirms tsc passes
- [x] Existing callers (`packages/cli/src/vault/indexer.ts`, `packages/core/src/__tests__/builder.test.ts`) use `buildGraphFromScanner`/`reindexFileInGraph` without provider arg — both work correctly since `provider` is optional with `undefined` default
- [x] No TODOs/FIXMEs introduced — confirmed via grep
- [x] `NativeParserProvider` + `createNativeParserProvider` correctly implement `ParserProvider` interface — confirmed at `packages/parser-native/ts/index.ts:32-57`
- [x] Graceful fallback: `IndexedTree` without provider passes `undefined` to `buildGraphFromScanner` which uses fallback path at `builder.ts:138-148`
- [x] `ParserProvider` interface exported from `@mdtree/core` — confirmed at `packages/core/src/index.ts:35`