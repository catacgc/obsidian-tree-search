# Tasks: rust-parser-07-plugin-bundle

## Task 1 — Add `@mdtree/parser-native` to root package.json dependencies

**Action:** Edit `package.json` (root) to add `"@mdtree/parser-native": "workspace:*"` to the `dependencies` section.

**Why first:** All subsequent tasks import from `@mdtree/parser-native`. The workspace resolution must be configured before those imports can resolve.

**Verification:** `bun install` succeeds without errors. TypeScript can resolve `@mdtree/parser-native` imports.

---

## Task 2 — Create esbuild WASM inline plugin in `esbuild.config.mjs`

**Action:** Add a custom esbuild plugin named `wasmInlinePlugin` to `esbuild.config.mjs`. The plugin:
- Uses the `onResolve` hook to intercept imports matching `*.wasm` with a custom namespace (e.g., `wasm-inline`).
- Uses the `onLoad` hook for that namespace to read the `.wasm` file from disk, convert it to a base64 string, and return a JS module that exports the base64 string as `default`.
- The resolved path should be the absolute path to `packages/parser-native/pkg/parser_native_bg.wasm`.

Register this plugin in the `plugins` array of `esbuildOptions` (before the existing plugins).

**Verification:** `node esbuild.config.mjs production` builds without error. The output `dist/main.js` contains a base64-encoded string (verifiable by grepping for a long alphanumeric constant).

---

## Task 3 — Create WASM bytes module (`src/wasm/parser-native-wasm.ts`)

**Action:** Create `src/wasm/parser-native-wasm.ts` with the following responsibilities:
- Import the `.wasm` file (the esbuild plugin resolves this to a base64 string module): `import wasmBase64 from "../../packages/parser-native/pkg/parser_native_bg.wasm"`
- Decode the base64 string to a `Uint8Array` using `atob()` and manual byte conversion (available in both browser and Obsidian's runtime).
- Export the decoded `Uint8Array` as `wasmBytes`.

Note: The import path must match what the esbuild `onResolve` hook will intercept. The module is only loaded at build time via esbuild; at runtime it's inlined.

**Verification:** TypeScript compilation passes (with the `// @ts-ignore` or declaration for the `.wasm` import). The module correctly exports a `Uint8Array`.

---

## Task 4 — Create native parser loader (`src/indexing/load-native-parser.ts`)

**Action:** Create `src/indexing/load-native-parser.ts` exporting:
```typescript
export async function loadNativeParserProvider(): Promise<ParserProvider | null>
```

Implementation:
1. Import `wasmBytes` from `../wasm/parser-native-wasm.ts`.
2. Import `loadNativeParser`, `createNativeParserProvider` from `@mdtree/parser-native`.
3. Import `type ParserProvider` from `@mdtree/core`.
4. Wrap the entire body in try/catch.
5. In the try block: call `const handle = await loadNativeParser(wasmBytes)`, then `return createNativeParserProvider(handle)`.
6. In the catch block: `console.warn("[mdtree] Failed to load native WASM parser, falling back to TypeScript parser:", error)` and `return null`.

**Verification:** The function type-checks. When WASM is available, returns a `ParserProvider`. When WASM loading fails (e.g., in test environment without WASM), returns `null` gracefully.

---

## Task 5 — Modify `IndexedTree` to accept optional `ParserProvider`

**Action:** Edit `src/indexing/indexed-tree.ts`:
1. Add import: `import type { ParserProvider } from "@mdtree/core"`.
2. Add a private field: `private provider: ParserProvider | undefined`.
3. Add a setter method: `setParserProvider(provider: ParserProvider): void { this.provider = provider }`.
4. In `refresh()`: pass `this.provider` as the third argument to `buildGraphFromScanner(scanner, settings, this.provider)`.
5. In `refreshPage()`: pass `this.provider` as the fifth argument to `reindexFileInGraph(file.path, this.graph, scanner, settings, this.provider)`.

**Verification:** The file type-checks. When no provider is set (`undefined`), `buildGraphFromScanner` and `reindexFileInGraph` receive `undefined` and operate in fallback mode (unchanged behavior). When a provider is set, it's threaded through.

---

## Task 6 — Modify `TreeSearchPlugin.onload()` to load WASM and inject provider

**Action:** Edit `src/main.ts`:
1. Add import: `import { loadNativeParserProvider } from "./indexing/load-native-parser"`.
2. In the `onload()` method, after `this.index = new IndexedTree(this.globalStore)` (line 43) and before `await this.index.refresh()` (line 159), add:
   ```typescript
   const nativeProvider = await loadNativeParserProvider()
   if (nativeProvider) {
     this.index.setParserProvider(nativeProvider)
     console.debug("[mdtree] Native WASM parser loaded successfully")
   }
   ```
3. This must be placed BEFORE the first `this.index.refresh()` call so the initial full-vault indexing uses the native parser.

**Verification:** The plugin loads without error. When WASM is available, a debug message appears in console and indexing uses the native parser. When WASM is unavailable, no error occurs and indexing proceeds with TS fallback.

---

## Task 7 — Verify build produces valid output

**Action:** Run `node esbuild.config.mjs production` and verify:
1. `dist/main.js` is produced without errors.
2. `dist/main.js` contains the base64-encoded WASM (search for a long base64 string).
3. No `dist/*.wasm` file is created (WASM is fully inlined).
4. `tsc -noEmit -skipLibCheck` passes without type errors.
5. The existing test suite (`bun test`) continues to pass.

**Verification:** Build succeeds, no external WASM files in dist, TypeScript compiles, tests pass.
