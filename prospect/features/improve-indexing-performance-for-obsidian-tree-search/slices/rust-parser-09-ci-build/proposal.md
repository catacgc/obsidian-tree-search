# Proposal: rust-parser-09-ci-build

## Problem & Outcome

**Problem:** The entire Rust/WASM parser feature (slices 01–08) has been implemented and verified locally, but there is no CI workflow that validates the WASM build, runs Rust tests, or executes the TypeScript test suite with the native parser active. The only existing CI workflow (`.github/workflows/main.yml`) is a tag-triggered release workflow that builds and publishes the Obsidian plugin — it does not run tests and is only triggered on git tags, not on pushes or pull requests.

Without CI, regressions in Rust code, behavioral divergence between Rust and TS parsers, WASM build failures, and TypeScript test breakages go undetected until manual local runs.

**Outcome:** A new GitHub Actions workflow that runs on every push and pull request, builds the WASM artifact from Rust source, executes `cargo test`, runs the full TypeScript test suite (which includes conformance tests comparing native vs TS parser output), and verifies the production esbuild build succeeds. This provides continuous validation of all prior slices' work.

## What This Slice Introduces

- A new GitHub Actions workflow file (`.github/workflows/ci.yml`) triggered on `push` and `pull_request` to all branches
- Rust stable toolchain setup with `wasm32-unknown-unknown` target
- `wasm-pack` installation and WASM build step
- `cargo test` step for Rust unit tests (137+ tests)
- Bun installation and `bun install` for dependency resolution
- `bun test` step for all TypeScript tests (252+ tests including native parser conformance)
- Production build verification step (`npm run build`)
- WASM gzip-compressed size gate (< 2 MB)
- Cargo target directory caching for faster subsequent builds

## Scope

**In scope:**
- New `.github/workflows/ci.yml` workflow file
- Rust toolchain + wasm-pack installation steps
- WASM build (`wasm-pack build --target web --out-dir pkg` in `packages/parser-native/`)
- `cargo test` in `packages/parser-native/`
- Bun installation and dependency install
- Full TypeScript test suite (`bun test` at root)
- Production esbuild build (`npm run build`)
- WASM binary compressed size assertion (< 2 MB)
- Cargo target directory caching

**Non-goals (explicitly excluded):**
- Modifying the existing tag-triggered release workflow (`.github/workflows/main.yml`)
- Running benchmarks in CI (performance-sensitive, not suitable for shared runners)
- Adding code coverage tooling
- Adding Rust linting (`clippy`) or formatting (`rustfmt`) checks
- Publishing WASM artifacts to npm or other registries
- Mobile-specific testing (requires device/emulator infrastructure)
- Bun dependency caching (Bun installs are already fast)

## Acceptance Criteria

1. A file `.github/workflows/ci.yml` exists and is a valid GitHub Actions workflow
2. The workflow triggers on `push` to any branch AND on `pull_request` to any branch
3. The workflow installs Rust stable toolchain with `wasm32-unknown-unknown` target
4. The workflow installs `wasm-pack` (version 0.12+)
5. `wasm-pack build --target web --out-dir pkg` succeeds in `packages/parser-native/`
6. `cargo test` runs in `packages/parser-native/` and passes all Rust tests
7. Bun is installed (version 1.x) and `bun install` succeeds
8. `bun test` at the repository root passes all TypeScript tests (including native parser conformance tests that load the built WASM)
9. `npm run build` (production esbuild build) succeeds, producing `dist/main.js`
10. The workflow asserts that the gzip-compressed `.wasm` file is under 2,097,152 bytes (2 MB), failing the job if exceeded
11. Cargo target directory (`packages/parser-native/target/`) is cached between runs using a key based on `Cargo.lock` hash
12. The workflow uses a single job on `ubuntu-latest`

## Feature Mapping

- **Source feature:** `rust-parser` (Rust/WASM indexing performance improvement)
- **Slice item:** `rust-parser-09-ci-build`
