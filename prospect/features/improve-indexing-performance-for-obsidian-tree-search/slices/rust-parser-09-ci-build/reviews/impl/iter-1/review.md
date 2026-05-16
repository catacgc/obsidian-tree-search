### Critical (must fix before archiving)

(none)

### Warnings (should address or explicitly defer)

- [ ] **`npm run build --if-present` deviates from spec's `npm run build`** — The proposal (AC9: line 63), tasks.md (line 43), and spec.md (line 74) all specify `npm run build` without `--if-present`. The `--if-present` flag means if the `build` script were absent from `package.json`, the step would silently succeed rather than error. While functionally equivalent today (since `build` is defined), this is a weaker guarantee than specified. The subsequent `ls -la dist/main.js` mitigates the risk, but the spec-implementation mismatch exists. — `.github/workflows/ci.yml:60`

### Suggestions (consider before or after archiving)

(none)

### Verified

- [x] **AC1: `.github/workflows/ci.yml` exists and is valid YAML** — confirmed at `.github/workflows/ci.yml:1-63`, proper workflow structure with `name`, `on`, `jobs`
- [x] **AC2: Triggers on push to any branch AND pull_request to any branch** — confirmed at `.github/workflows/ci.yml:4-7` with `branches: ["**"]` for both
- [x] **AC3: Rust stable toolchain with `wasm32-unknown-unknown` target** — confirmed at `.github/workflows/ci.yml:17-19` using `dtolnay/rust-toolchain@stable` with `targets: wasm32-unknown-unknown`
- [x] **AC4: wasm-pack installation** — confirmed at `.github/workflows/ci.yml:28-29` via curl installer
- [x] **AC5: `wasm-pack build --target web --out-dir pkg` in `packages/parser-native/`** — confirmed at `.github/workflows/ci.yml:31-33` with correct working-directory
- [x] **AC6: `cargo test` in `packages/parser-native/`** — confirmed at `.github/workflows/ci.yml:35-37` with correct working-directory
- [x] **AC7: Bun installed and `bun install` succeeds** — confirmed at `.github/workflows/ci.yml:50-54` using `oven-sh/setup-bun@v2` + `bun install`
- [x] **AC8: `bun test` at repository root** — confirmed at `.github/workflows/ci.yml:56-57`; `bun test` discovers workspace tests recursively (packages/core + packages/parser-native + src tests)
- [x] **AC9: Production build step** — confirmed at `.github/workflows/ci.yml:59-60` (functionally equivalent, see Warning above)
- [x] **AC10: WASM gzip size gate < 2,097,152 bytes** — confirmed at `.github/workflows/ci.yml:39-48` with gzip compression, `stat --format=%s`, and threshold check with `exit 1`
- [x] **AC11: Cargo target directory cached** — confirmed at `.github/workflows/ci.yml:21-26` with `actions/cache@v4`, path `packages/parser-native/target/`, key including `runner.os` + `Cargo.lock` hash, and partial `restore-keys` fallback
- [x] **AC12: Single job on ubuntu-latest** — confirmed at `.github/workflows/ci.yml:11` with `runs-on: ubuntu-latest`
- [x] **Task ordering correct** — WASM build (line 31) precedes Rust tests (line 35), which precedes size check (line 39), which precedes Bun tests (line 56), which precedes production build (line 59)
- [x] **Build output verification** — confirmed at `.github/workflows/ci.yml:62-63` with `ls -la dist/main.js`
- [x] **`stat --format=%s` compatible with ubuntu-latest** — GNU coreutils `stat` format, correct for Linux runners
- [x] **No Node.js setup step needed** — `ubuntu-latest` has Node.js pre-installed; `npm run build` uses system Node.js with `bun install`-resolved `node_modules`
- [x] **Test files discoverable by `bun test`** — Confirmed test files exist in `packages/core/src/__tests__/` (9 files), `packages/parser-native/ts/__tests__/` (5 files), and `src/view/__tests__/` (1 file)
- [x] **WASM artifact path consistent** — `packages/parser-native/pkg/parser_native_bg.wasm` used in both size check (ci.yml:41) and test loader (loader.test.ts:6)