# Tasks: rust-parser-09-ci-build

## Task 1 — Create `.github/workflows/ci.yml` with trigger and job skeleton

Create the file `.github/workflows/ci.yml` with:
- Workflow name: `CI`
- Trigger on `push` (all branches) and `pull_request` (all branches)
- A single job `build-and-test` running on `ubuntu-latest`
- First step: `actions/checkout@v4`

## Task 2 — Add Rust toolchain setup and Cargo cache

In the `build-and-test` job, after checkout, add steps:
- Use `dtolnay/rust-toolchain@stable` with `targets: wasm32-unknown-unknown`
- Use `actions/cache@v4` to cache `packages/parser-native/target/` directory with key `cargo-${{ runner.os }}-${{ hashFiles('packages/parser-native/Cargo.lock') }}` and `restore-keys: cargo-${{ runner.os }}-` for partial-match fallback

## Task 3 — Add wasm-pack installation and WASM build step

Add steps:
- Install `wasm-pack` via `curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh`
- Run `wasm-pack build --target web --out-dir pkg` with `working-directory: packages/parser-native`

## Task 4 — Add Rust test and WASM size check steps

Add steps:
- Run `cargo test` with `working-directory: packages/parser-native`
- Run a shell script step that:
  1. Compresses `packages/parser-native/pkg/parser_native_bg.wasm` with `gzip -c` to a temporary file
  2. Measures the compressed file size
  3. Prints the size in bytes to the log
  4. Fails with `exit 1` if the size exceeds 2,097,152 bytes (2 MB)

## Task 5 — Add Bun installation, dependency install, and TypeScript test step

Add steps:
- Use `oven-sh/setup-bun@v2` (latest Bun 1.x)
- Run `bun install` at repository root
- Run `bun test` at repository root (executes all tests across workspace packages: `packages/core/src/__tests__/` and `packages/parser-native/ts/__tests__/`)

## Task 6 — Add production build verification step

Add step:
- Run `npm run build` at repository root. This executes the full build pipeline: `prebuild:wasm` (Cargo performs a no-work incremental check since the WASM was already built in Task 3 — effectively instant), then `tsc -noEmit -skipLibCheck`, then `node esbuild.config.mjs production`. This validates that the complete production build, including esbuild's WASM base64 inlining, succeeds end-to-end.
- After the build, add `ls -la dist/main.js` for log visibility confirming the output artifact exists.
