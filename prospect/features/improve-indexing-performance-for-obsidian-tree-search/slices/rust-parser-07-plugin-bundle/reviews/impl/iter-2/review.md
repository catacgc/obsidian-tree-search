### Critical (must fix before archiving)
(none)

### Warnings (should address or explicitly defer)
(none)

### Suggestions (consider before or after archiving)
(none)

### Verified
- [x] **[Previously Warning] wasm-pack glue code emits deprecation warning at runtime** — FIXED at `packages/parser-native/ts/loader.ts:31`. Now uses `await glue.default({ module_or_path: wasmBytes })` which passes the WASM bytes as an object property, satisfying the `Object.getPrototypeOf(module_or_path) === Object.prototype` check in the glue code and avoiding the `console.warn('using deprecated parameters...')` branch. The comment at lines 19-20 documents the rationale.
- [x] **[Previously Warning] Potential race condition: interval-triggered refresh can start before WASM is loaded** — FIXED at `src/main.ts:48-52`. The WASM loading (`await loadNativeParserProvider()`) and `setParserProvider()` call now occur immediately after `IndexedTree` construction (line 44) and BEFORE the `isGraphLoadingAtom` subscription (line 114) and the `setInterval` (line 122). This ensures the native parser provider is always set before any mechanism that could trigger `this.index.refresh()` fires.
- [x] AC1: esbuild WASM inline plugin — confirmed at `esbuild.config.mjs:12-28`
- [x] AC2: `loader: { '.wasm': 'empty' }` suppression — confirmed at `esbuild.config.mjs:87`
- [x] AC4: `loadNativeParserProvider` returns `ParserProvider | null` — confirmed at `src/indexing/load-native-parser.ts:13`
- [x] AC5: WASM failure caught with `console.warn` — confirmed at `src/indexing/load-native-parser.ts:20`
- [x] AC6: `IndexedTree.setParserProvider` setter — confirmed at `src/indexing/indexed-tree.ts:17-19`
- [x] AC7: `refresh()` passes provider to `buildGraphFromScanner` — confirmed at `src/indexing/indexed-tree.ts:41`
- [x] AC8: `refreshPage()` passes provider to `reindexFileInGraph` — confirmed at `src/indexing/indexed-tree.ts:61`
- [x] AC9: `onload()` loads WASM and sets provider before any refresh trigger — confirmed at `src/main.ts:48-52` (before interval at line 122 and subscription at line 114)
- [x] AC10: If factory returns null, plugin continues without crash — confirmed at `src/main.ts:49` (conditional guard)