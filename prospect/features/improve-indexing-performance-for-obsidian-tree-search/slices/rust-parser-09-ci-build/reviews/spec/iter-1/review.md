### Critical (must fix before implementation)

(none)

### Warnings (should address, discuss if not)

- [ ] **Existing release workflow (`main.yml`) will fail on next tag push** — The tag-triggered release workflow at `.github/workflows/main.yml:26` runs `npm run build --if-present`, which since slice 07 now executes `prebuild:wasm` requiring Rust + wasm-pack. The release workflow installs neither. While this slice's non-goals explicitly exclude modifying `main.yml`, the CI slice is the natural place to ensure *all* CI/CD paths work. At minimum, the proposal should acknowledge this as a known broken state and recommend a follow-up fix (e.g., the release workflow should reuse the new CI steps or install Rust/wasm-pack). — `proposal.md:37` (non-goals) + `.github/workflows/main.yml:24-26`
- [ ] **Task 6 incorrectly states `prebuild:wasm` is "a no-op since WASM is already built"** — `wasm-pack build` always recompiles from source; it is not idempotent in the "no-op" sense. In CI this means WASM is built TWICE (once in Task 3, once again in Task 6 via `npm run build`). While functionally harmless and even useful as validation of the full `build` path, the task description's reasoning is incorrect and could confuse the implementer into thinking the step can be skipped or reordered. — `tasks.md:39`

### Suggestions (think about these, optional)

- [ ] **Cargo cache key should incorporate Rust toolchain version** — Task 2 bases the cache key solely on `hashFiles('packages/parser-native/Cargo.lock')`. If the Rust stable toolchain is updated between runs (e.g., 1.78 → 1.79), the cached `target/` directory may contain stale incremental artifacts, potentially causing obscure build failures. Adding the runner OS + Rust version to the key (e.g., `runner.os + '-cargo-' + rustc --version hash + hashFiles('**/Cargo.lock')`) is standard practice. — `tasks.md:15`
- [ ] **Consider pinning wasm-pack version for reproducibility** — Task 3 installs wasm-pack via `curl ... | sh` which fetches the latest version. A future wasm-pack breaking change could silently fail CI. Consider pinning (e.g., `cargo binstall wasm-pack@0.13.1` or specifying version in the installer URL). — `tasks.md:21`

### Confirmed Coverage

- [x] **Acceptance criteria present and complete** — 12 specific, testable acceptance criteria covering triggers, tooling, build, tests, size gate, and caching
- [x] **Task ordering correct** — WASM build (Task 3) precedes Rust tests (Task 4) and TS tests (Task 5) which depend on the built `.wasm` file at `packages/parser-native/pkg/parser_native_bg.wasm`
- [x] **Scope aligned with feature's planned slice sequence** — Exactly matches `rust-parser-09-ci-build` as described in the feature proposal
- [x] **No scope drift** — Non-goals are explicitly stated and reasonable (no benchmarks, no clippy, no release workflow changes)
- [x] **Feature-level acceptance criterion covered** — The feature proposal's "Benchmark harness and CI for WASM builds" is directly addressed
- [x] **`Cargo.lock` available for cache key** — Confirmed at `packages/parser-native/Cargo.lock`, not gitignored
- [x] **WASM artifact path (`pkg/parser_native_bg.wasm`) is consistent** — Task 4 size check, spec scenarios, and TS test files all reference the same path
- [x] **`bun test` will discover workspace tests** — Root `package.json` has `"workspaces": ["packages/*"]` and `"test": "bun test"`, workspace packages also define their test scripts
- [x] **`rust-toolchain.toml` exists** — Confirmed at `packages/parser-native/rust-toolchain.toml` with `channel = "stable"`, consistent with Task 2's `dtolnay/rust-toolchain@stable`
- [x] **Spec requirements use SHALL/MUST language and Given/When/Then structure** — All 6 requirements with 9 scenarios follow this pattern correctly