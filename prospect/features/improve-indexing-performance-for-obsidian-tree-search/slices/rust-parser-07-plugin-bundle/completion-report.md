## Completion Checklist

### Tasks
- [x] Task 1 — Add `@mdtree/parser-native` to root `package.json` and `prebuild:wasm` script — PASS: `package.json:9` has `prebuild:wasm`, line 10 chains it into `build`, line 43 has `@mdtree/parser-native: "workspace:*"`
- [x] Task 2 — Create esbuild WASM inline plugin in `esbuild.config.mjs` — PASS: `wasmInlinePlugin` at lines 12-28, `onResolve`/`onLoad` hooks, `loader: { '.wasm': 'empty' }` at line 87
- [x] Task 3 — Create WASM bytes module (`src/wasm/parser-native-wasm.ts`) — PASS: Imports `.wasm`, decodes base64 to `Uint8Array`, exports `wasmBytes`
- [x] Task 4 — Create native parser loader (`src/indexing/load-native-parser.ts`) — PASS: Async function with try/catch, returns `ParserProvider | null`, `console.warn` on failure
- [x] Task 5 — Modify `IndexedTree` with setter for `ParserProvider` — PASS: `setParserProvider` at line 17-19, `this.provider` threaded to `buildGraphFromScanner` (line 41) and `reindexFileInGraph` (line 61)
- [x] Task 6 — Modify `TreeSearchPlugin.onload()` to load WASM before first refresh — PASS: Lines 48-52, WASM loaded after `IndexedTree` construction but before any interval/subscription/refresh
- [x] Task 7 — Verify build produces valid output — PASS: `dist/main.js` contains base64 WASM, no `.wasm` in dist, `styles.css` and `manifest.json` present, CJS format

### Tests
- [x] Full suite: 252 passed, 0 failed — PASS

### Code State
- [x] No uncommitted changes to slice code — PASS (3 unrelated pre-existing changes: deleted `.claude/settings.local.json`, modified `.gitignore`, deleted `CLAUDE.md`)
- [x] No TODOs/FIXMEs introduced — PASS (only pre-existing `state.tsx:508` TODO)

### Acceptance Criteria
- [x] AC1: esbuild WASM inline plugin resolves `.wasm` imports to base64 — PASS: `esbuild.config.mjs:12-28`
- [x] AC2: `loader: { '.wasm': 'empty' }` suppresses asset emission — PASS: `esbuild.config.mjs:87`
- [x] AC3: Production build produces `dist/main.js` with embedded WASM, no `.wasm` in dist — PASS: confirmed `AGFzbQ` present, no `.wasm` files in dist
- [x] AC4: `loadNativeParserProvider` returns `ParserProvider | null` — PASS: `src/indexing/load-native-parser.ts:13`
- [x] AC5: WASM failure caught with `console.warn`, returns `null` — PASS: lines 19-21
- [x] AC6: `IndexedTree` has `setParserProvider` setter — PASS: `src/indexing/indexed-tree.ts:17-19`
- [x] AC7: `refresh()` passes provider as 3rd arg to `buildGraphFromScanner` — PASS: line 41
- [x] AC8: `refreshPage()` passes provider as 5th arg to `reindexFileInGraph` — PASS: line 61
- [x] AC9: `onload()` loads WASM and sets provider before first `refresh()` — PASS: `src/main.ts:48-52` before interval (line 122) and refresh (line 168)
- [x] AC10: If factory returns null, plugin continues — PASS: conditional guard at line 49
- [x] AC11: Root `package.json` has `@mdtree/parser-native` dep and `prebuild:wasm` script — PASS: lines 9, 43
- [x] AC12: `dist/main.js` is valid CJS — PASS: esbuild `format: "cjs"` confirmed
- [x] AC13: No new runtime dependencies beyond workspace packages — PASS: confirmed
- [x] AC14: TypeScript compiles (implementation verified via prior output and build success) — PASS

## Verdict
READY FOR ARCHIVE