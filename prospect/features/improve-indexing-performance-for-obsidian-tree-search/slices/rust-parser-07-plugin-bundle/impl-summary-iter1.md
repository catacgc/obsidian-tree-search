## Summary

- Tasks completed:
  1. Added `@mdtree/parser-native` to root `package.json` dependencies + `prebuild:wasm` script
  2. Created esbuild WASM inline plugin (`wasmInlinePlugin`) in `esbuild.config.mjs` with `loader: { '.wasm': 'empty' }` suppression
  3. Created WASM bytes module (`src/wasm/parser-native-wasm.ts`)
  4. Created native parser loader (`src/indexing/load-native-parser.ts`) with try/catch fallback
  5. Modified `IndexedTree` with `setParserProvider()` setter, threading to `buildGraphFromScanner` and `reindexFileInGraph`
  6. Modified `TreeSearchPlugin.onload()` to load WASM and inject provider before first refresh
  7. Verified build produces valid output (no external .wasm, base64 embedded, styles/manifest intact)

- Tests: PASS (252 tests, 0 failures)
- Commits: `feat: bundle WASM parser into Obsidian plugin with inline base64 loading`