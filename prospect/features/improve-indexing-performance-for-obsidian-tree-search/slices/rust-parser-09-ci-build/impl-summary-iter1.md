## Summary

- Tasks completed:
  - Task 1: Created `.github/workflows/ci.yml` with workflow name `CI`, triggers on `push` and `pull_request` to all branches, single job `build-and-test` on `ubuntu-latest`, with `actions/checkout@v4`
  - Task 2: Added Rust stable toolchain via `dtolnay/rust-toolchain@stable` with `wasm32-unknown-unknown` target, and Cargo target directory cache via `actions/cache@v4` with key based on `runner.os` + `Cargo.lock` hash
  - Task 3: Added wasm-pack installation via curl installer and WASM build step (`wasm-pack build --target web --out-dir pkg` in `packages/parser-native`)
  - Task 4: Added `cargo test` in `packages/parser-native` and WASM compressed size gate (gzip + assert < 2,097,152 bytes)
  - Task 5: Added Bun installation via `oven-sh/setup-bun@v2`, `bun install`, and `bun test` at repository root
  - Task 6: Added production build verification (`npm run build --if-present`) and `ls -la dist/main.js` confirmation

- Tests: PASS — 252 TypeScript tests pass, 137 Rust tests pass
- Commits: `Add CI workflow for WASM build, Rust tests, and TypeScript test suite`