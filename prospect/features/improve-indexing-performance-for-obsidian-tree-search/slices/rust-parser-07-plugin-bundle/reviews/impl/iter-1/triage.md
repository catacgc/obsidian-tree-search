## Finding Inventory

| # | Severity | Claim | Location |
|---|----------|-------|----------|
| 1 | Warning | wasm-pack glue code emits deprecation warning at runtime — passing `wasmBytes` directly triggers console.warn | `packages/parser-native/ts/loader.ts:30` + `packages/parser-native/pkg/parser_native.js:333-336` |
| 2 | Warning | Potential race condition: interval-triggered refresh can start before WASM is loaded | `src/main.ts:114-118` vs `src/main.ts:160-166` |
| 3 | Suggestion | Dead `declare const wasmBase64: string` in WASM bytes module | `src/wasm/parser-native-wasm.ts:4` |

---

### Accepted
- [ ] [Warning] **wasm-pack glue code emits deprecation warning at runtime** — `packages/parser-native/ts/loader.ts:30`. Confirmed: `await glue.default(wasmBytes)` passes a `Uint8Array` directly. The glue code at line 332-336 checks `Object.getPrototypeOf(module_or_path) === Object.prototype` — for `Uint8Array` this is `false`, so the `else` branch fires `console.warn('using deprecated parameters...')` on every plugin load. Fix is trivial: change to `await glue.default({ module_or_path: wasmBytes })`. While functionally harmless (WASM loads correctly since `__wbg_load` handles `BufferSource` at line 291), it pollutes the console on every Obsidian startup and signals API misuse.
- [ ] [Warning] **Potential race condition: interval-triggered refresh can start before WASM is loaded** — `src/main.ts:114-118` sets a 2000ms interval that triggers `refresh()` when graph is empty. The `await loadNativeParserProvider()` at line 160 yields during `WebAssembly.instantiate`, allowing the interval to fire. If WASM loading takes >2s (unlikely but possible on constrained mobile devices), the first refresh runs without the native provider, and the explicit `this.index.refresh()` at line 166 is then skipped by the `isLoading` guard (`indexed-tree.ts:30`). This contradicts spec scenario "First graph refresh uses native parser." Fix: move WASM loading (lines 160-164) before the interval setup (line 114), or defer first refresh to after provider is set.

### Dismissed
- [x] [Suggestion] **Dead `declare const wasmBase64: string` in WASM bytes module** — While technically unused (line 4 declares `wasmBase64` but line 6 imports `wasmBase64Imported`), this `declare` statement serves as documentation of the esbuild plugin's contract: it communicates to readers that the `.wasm` import will be resolved to a string. It's a minor stylistic leftover that has no runtime impact, no correctness risk, and does not justify specification-level change. Removing it is a trivial cleanup that doesn't need to block the review loop.