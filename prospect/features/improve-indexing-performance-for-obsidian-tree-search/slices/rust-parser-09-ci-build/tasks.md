# Tasks: rust-parser-09-ci-build

## Task 1 — Create `.github/workflows/ci.yml` with trigger and job skeleton

Create the file `.github/workflows/ci.yml` with:
- Workflow name: `CI`
- Trigger on `push` (all branches) and `pull_request` (all branches)
- A single job `build-and-test` running on `ubuntu-latest`
- First step: `actions/checkout@v4`

## Task 2 — Add Rust toolchain setup and Cargo cache

In the `build-and-test` job, add steps:
- Use `dtolnay/rust-toolchain@stable` with `targets: wasm32-unknown-unknown`
- Use `actions/cache@v4` to cache `packages/parser-native/target/` directory with a key incorporating `hashFiles('packages/parser-native/Cargo.lock')` and a restore-key prefix for partial matches

## Task 3 — Add wasm-pack installation and WASM build step

Add steps:
- Install `wasm-pack` via `curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh`
- Run `wasm-pack build --target web --out-dir pkg` in `packages/parser-native/` working directory

## Task 4 — Add Rust test and WASM size check steps

Add steps:
- Run `cargo test` in `packages/parser-native/` working directory
- Run a shell script that gzip-compresses `packages/parser-native/pkg/parser_native_bg.wasm`, measures the compressed size, prints it, and fails with exit code 1 if it exceeds 2,097,152 bytes (2 MB)

## Task 5 — Add Bun installation, dependency install, and TypeScript test steps

Add steps:
- Use `oven-sh/setup-bun@v2` (latest Bun 1.x)
- Run `bun install` at repository root
- Run `bun test` at repository root (executes all tests in `packages/core` and `packages/parser-native/ts/__tests__/`)

## Task 6 — Add production build verification step

Add step:
- Run `npm run build` at repository root (executes `prebuild:wasm` which is a no-op since WASM is already built, then `tsc -noEmit -skipLibCheck`, then esbuild production)
- The step inherently fails if the build fails; add `ls -la dist/main.js` afterward for visibility in logs
