### Critical (must fix before implementation)
(none)

### Warnings (should address, discuss if not)
(none)

### Suggestions (think about these, optional)
(none)

### Confirmed Coverage
- [x] **[Previously Warning] Glue code's `new URL('parser_native_bg.wasm', import.meta.url)` is not handled by the proposed esbuild WASM inline plugin** — fully resolved. The revised `proposal.md` (lines 7, 13) explicitly calls out the `new URL(...)` pattern and the `loader: { '.wasm': 'empty' }` suppression. `tasks.md:Task 2` (lines 22-30) provides detailed explanation of WHY this is needed and HOW it works — specifying the `loader` entry and confirming the `onResolve`/`onLoad` hooks take priority for explicit imports. `spec.md` adds a dedicated scenario "Glue code's new URL pattern does not emit external assets" (lines 19-23). AC #2 (proposal line 53) specifically requires this.
- [x] **[Previously Warning] `pkg/` directory is gitignored but required at build time — no build-ordering guidance** — fully resolved. `proposal.md` item 7 (line 25) explicitly adds build prerequisite documentation. `tasks.md:Task 1` (lines 7-8) adds a `prebuild:wasm` script and chains it into the `build` script. AC #11 (proposal line 62) requires this. `spec.md` (lines 33-50) adds two dedicated scenarios: "Fresh checkout build succeeds with documented steps" and "Esbuild fails clearly if WASM prerequisite is skipped."
- [x] **[Previously Warning] Feature design says constructor injection for `IndexedTree` but tasks say setter injection** — fully resolved. `proposal.md` item 4 (lines 19) explicitly states setter pattern with rationale explaining the async timing constraint. `tasks.md:Task 5` (lines 116) includes a "Rationale for setter over constructor" section explaining why the design doc's "Constructor accepts `ParserProvider`" is architecturally incorrect for the actual code flow (IndexedTree constructed synchronously at `main.ts:43`, WASM loads asynchronously after). AC #6 (proposal line 57) specifies setter. `spec.md` requirement (line 100-121) explicitly states "The setter pattern is used because WASM loading is async and completes after `IndexedTree` construction" with scenarios for both set and unset states.