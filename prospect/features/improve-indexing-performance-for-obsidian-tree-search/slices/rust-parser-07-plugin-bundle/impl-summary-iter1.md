## Summary

- Tasks completed:
  1. **Fixed wasm-pack glue deprecation warning** — Changed `loader.ts:30` from `await glue.default(wasmBytes)` to `await glue.default({ module_or_path: wasmBytes })`, which passes the WASM bytes using the non-deprecated object API (matching the `Object.getPrototypeOf` check at line 333 of the glue code).
  2. **Fixed startup race condition** — Moved the WASM loading block (`loadNativeParserProvider()` + `setParserProvider()`) from after the interval/subscription setup to immediately after `IndexedTree` construction, ensuring the native parser is always set before any interval-triggered refresh can fire.

- Tests: PASS — 252 TypeScript tests, 85 parser-native TS tests, 137 Rust tests, TypeScript type-check clean, production build succeeds with no external `.wasm` in dist
- Commits: `fix: resolve WASM loader deprecation warning and startup race condition`