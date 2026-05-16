### Finding Inventory

| # | Severity | Claim | Location |
|---|----------|-------|----------|
| 1 | Warning | Glue code's `new URL('parser_native_bg.wasm', import.meta.url)` is not handled by the proposed esbuild WASM inline plugin | `tasks.md:Task 2` + `packages/parser-native/pkg/parser_native.js:341` |
| 2 | Warning | `pkg/` directory is gitignored but required at build time — no build-ordering guidance | `tasks.md:Task 7` + `packages/parser-native/.gitignore:1` |
| 3 | Warning | Feature design says constructor injection for `IndexedTree` but tasks say setter injection | `tasks.md:Task 5` vs `prospect/.../design.md:154` |
| 4 | Suggestion | Consider documenting that `loadNativeParser` performs two chained dynamic imports that esbuild must inline | `tasks.md:Task 4` + `packages/parser-native/ts/loader.ts:21` |

### Phase 2 — Independent Deep Assessment

**Finding 1: Glue code `new URL(...)` pattern**

I verified:
- `parser_native.js:341` does contain `new URL('parser_native_bg.wasm', import.meta.url)` — confirmed.
- The proposed esbuild plugin (Task 2) intercepts `.wasm` **imports** via `onResolve`/`onLoad` hooks — this is for the explicit `.wasm` import in `src/wasm/parser-native-wasm.ts`.
- The `new URL(...)` pattern is NOT an import statement — it's a runtime URL construction.
- At runtime, this code path is unreachable because `loadWasm(wasmBytes)` always passes bytes explicitly via `glue.default(wasmBytes)`, so `module_or_path !== undefined` at line 332.
- However, esbuild statically processes bundled files. With `bundle: true`, the dynamic import at `loader.ts:21` (`await import("../pkg/parser_native.js")`) will be resolved by esbuild. When esbuild encounters `new URL('parser_native_bg.wasm', import.meta.url)` in the bundled code, its default `.wasm` loader (`file`) may copy the file to `dist/` as an asset — violating AC #2 ("no external `.wasm` file in `dist/`").
- The mitigation is straightforward: add a `loader: { '.wasm': 'empty' }` or intercept `.wasm` file resolution in the esbuild plugin. But the current Task 2 description doesn't address this.

**Finding 2: `pkg/` gitignored but required at build time**

I verified:
- `packages/parser-native/.gitignore` line 1: `pkg/` — confirmed, the entire directory is gitignored.
- `packages/parser-native/pkg/.gitignore` line 1: `*` — confirmed.
- The esbuild WASM plugin (Task 2) resolves the path to `packages/parser-native/pkg/parser_native_bg.wasm` to read it at build time.
- `loader.ts:21` dynamically imports `../pkg/parser_native.js` — esbuild needs this file at bundle time.
- On a fresh checkout, `pkg/` would not exist.
- `packages/parser-native/package.json:9` has `"build:wasm": "wasm-pack build --target web --out-dir pkg"` — the build script exists.
- Task 7 says "Run `node esbuild.config.mjs production`" but doesn't mention running `wasm-pack build` as a prerequisite.
- The design Risk section says "commit built `.wasm` to repo" but the gitignore directly contradicts this.

This is a valid concern for implementability — Task 7's verification steps cannot succeed without running `wasm-pack build` first, which is nowhere documented in the tasks.

**Finding 3: Constructor vs. setter injection**

I verified:
- Feature design (`design.md:154`): "Constructor accepts `ParserProvider`; passes to `buildGraphFromScanner` and `reindexFileInGraph`" — confirmed.
- Task 5: "Add a setter method: `setParserProvider(provider: ParserProvider): void`" — confirmed.
- Current `indexed-tree.ts:12`: `constructor(private store: GlobalStore)` — only takes `GlobalStore`.
- `main.ts:43`: `this.index = new IndexedTree(this.globalStore)` — created before WASM loads.
- Task 6: WASM loading happens AFTER `IndexedTree` construction with async `await loadNativeParserProvider()`.

The setter approach IS correct because WASM loading is async and happens after `IndexedTree` construction. Constructor injection would require restructuring the plugin init flow. But the inconsistency with the design doc could confuse the implementer about intended architecture.

**Finding 4: Dynamic import chain documentation**

I verified:
- `packages/parser-native/ts/index.ts:22`: `const { loadWasm } = await import("./loader.ts")`
- `packages/parser-native/ts/loader.ts:21`: `const glue = await import("../pkg/parser_native.js")`
- Both are dynamic imports with literal string paths that esbuild with `bundle: true` will resolve and inline.
- If a future esbuild config change enables code splitting or marks these as external, the plugin loading breaks silently on mobile (no filesystem for separate chunks).
- This is a non-obvious dependency chain: two levels of dynamic imports that MUST be bundled together for the base64-inline strategy to work.

---

### Accepted
- [ ] [Warning] **Glue code's `new URL('parser_native_bg.wasm', import.meta.url)` is not handled by the proposed esbuild WASM inline plugin** — `tasks.md:Task 2` + `packages/parser-native/pkg/parser_native.js:341`. Confirmed: esbuild with `bundle: true` resolves the dynamic import of `parser_native.js` and encounters line 341's `new URL('parser_native_bg.wasm', import.meta.url)`. esbuild's default `.wasm` loader is `file`, which copies assets to the output directory — potentially emitting `parser_native_bg.wasm` to `dist/` and violating AC #2. Task 2 must specify how to suppress this (e.g., configuring `loader: { '.wasm': 'binary' }` or extending the plugin to handle `.wasm` file resolution, not just imports).
- [ ] [Warning] **`pkg/` directory is gitignored but required at build time — no build-ordering guidance** — `packages/parser-native/.gitignore:1` confirms `pkg/` is gitignored; Task 7 says "Run `node esbuild.config.mjs production`" without mentioning the prerequisite `wasm-pack build`. On a fresh checkout `pkg/` does not exist, and the esbuild WASM plugin reads `pkg/parser_native_bg.wasm` from disk. A build-ordering note (or a pre-build script) is needed for the tasks to be completable.
- [ ] [Warning] **Feature design says constructor injection for `IndexedTree` but tasks say setter injection** — `design.md:154` says "Constructor accepts `ParserProvider`" while `tasks.md:Task 5` specifies a setter. The setter approach is architecturally correct (WASM loads asynchronously at `main.ts` after `IndexedTree` construction at line 43), but the inconsistency should be resolved in the design doc to avoid implementer confusion.

### Dismissed
- [x] [Suggestion] **Consider documenting that `loadNativeParser` performs two chained dynamic imports that esbuild must inline** — While technically valid as a long-term maintenance note, esbuild's behavior with `bundle: true` reliably inlines dynamic imports of literal string paths. The current config (`bundle: true`, no code splitting, no external markers for workspace packages) guarantees both dynamic imports are bundled. A comment might help future maintainers, but this is a stylistic preference at this abstraction level, not a structural risk requiring specification-level change. The existing behavior is correct and stable under the current config.