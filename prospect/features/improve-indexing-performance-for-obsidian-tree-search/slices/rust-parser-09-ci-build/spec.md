# Spec: rust-parser-09-ci-build

## ADDED Requirements

---

### Requirement: CI workflow SHALL build WASM and run all tests on every push and pull request

The CI pipeline MUST build the Rust WASM artifact, execute Rust unit tests, run all TypeScript tests (including native parser conformance tests), and verify the production build on every code change.

#### Scenario: Push to any branch triggers CI

- **Given** a developer pushes a commit to any branch in the repository
- **When** the push event is received by GitHub Actions
- **Then** the `ci.yml` workflow SHALL be triggered and execute all defined steps

#### Scenario: Pull request triggers CI

- **Given** a developer opens or updates a pull request targeting any branch
- **When** the pull_request event is received by GitHub Actions
- **Then** the `ci.yml` workflow SHALL be triggered and execute all defined steps

---

### Requirement: CI workflow SHALL build WASM from Rust source using wasm-pack

The CI pipeline MUST install the Rust stable toolchain with `wasm32-unknown-unknown` target, install `wasm-pack`, and successfully produce the `.wasm` artifact in `packages/parser-native/pkg/`.

#### Scenario: WASM build succeeds

- **Given** the CI runner has the Rust stable toolchain with `wasm32-unknown-unknown` target and `wasm-pack` installed
- **When** `wasm-pack build --target web --out-dir pkg` is executed in `packages/parser-native/`
- **Then** the file `packages/parser-native/pkg/parser_native_bg.wasm` SHALL exist and the step SHALL exit with code 0

#### Scenario: WASM compressed size is under 2 MB

- **Given** the WASM artifact has been built at `packages/parser-native/pkg/parser_native_bg.wasm`
- **When** the file is gzip-compressed and its byte size is measured
- **Then** the compressed size SHALL be less than 2,097,152 bytes (2 MB), and the workflow step SHALL fail if this threshold is exceeded

---

### Requirement: CI workflow SHALL execute Rust unit tests

The CI pipeline MUST run `cargo test` to validate all Rust unit tests pass after the WASM build.

#### Scenario: Rust tests pass

- **Given** the Rust dependencies have been compiled (during the wasm-pack build or explicitly)
- **When** `cargo test` is executed in `packages/parser-native/`
- **Then** all Rust unit tests SHALL pass and the step SHALL exit with code 0

---

### Requirement: CI workflow SHALL execute all TypeScript tests with WASM active

The CI pipeline MUST install Bun, install project dependencies, and run the full TypeScript test suite which includes conformance tests that load the built WASM module and compare its output against the TypeScript parser.

#### Scenario: TypeScript tests pass with native parser

- **Given** the WASM artifact exists at `packages/parser-native/pkg/parser_native_bg.wasm` and Bun dependencies are installed via `bun install`
- **When** `bun test` is executed at the repository root
- **Then** all TypeScript tests SHALL pass, including native parser conformance tests in `packages/parser-native/ts/__tests__/` and core integration tests in `packages/core/src/__tests__/`

---

### Requirement: CI workflow SHALL verify the production plugin build

The CI pipeline MUST execute the full production build pipeline to ensure the plugin bundle compiles correctly with the inline WASM artifact.

#### Scenario: Production build succeeds

- **Given** WASM has been built and TypeScript dependencies are installed
- **When** `npm run build` is executed at the repository root
- **Then** `dist/main.js` SHALL be produced and the build step SHALL exit with code 0

---

### Requirement: CI workflow SHALL cache Rust compilation artifacts

The CI pipeline MUST cache the Cargo target directory to reduce Rust compilation time on subsequent runs with unchanged dependencies.

#### Scenario: Cache hit restores Rust artifacts

- **Given** a prior CI run completed and cached `packages/parser-native/target/` with a key based on the `Cargo.lock` hash
- **When** a new CI run starts with an unchanged `Cargo.lock`
- **Then** the cached target directory SHALL be restored before the build step executes

#### Scenario: Cache miss triggers full compilation

- **Given** `Cargo.lock` has changed since the last cached run (or no cache exists)
- **When** the cache restore step runs
- **Then** the cache SHALL miss (or use a partial restore-key prefix), and the WASM build step SHALL compile all dependencies from source
