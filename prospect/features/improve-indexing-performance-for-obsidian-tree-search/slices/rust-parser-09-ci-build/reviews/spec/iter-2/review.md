### Critical (must fix before implementation)

(none)

### Warnings (should address, discuss if not)

(none)

### Suggestions (think about these, optional)

(none)

### Confirmed Coverage

- [x] **[Previously Warning] Existing release workflow (`main.yml`) will fail on next tag push** — fully resolved. The revised `proposal.md:45-51` now contains a dedicated "Known Issue: Release Workflow Breakage" section that:
  - Accurately documents the problem (`.github/workflows/main.yml:26` runs `npm run build --if-present`, which since slice 07 invokes `prebuild:wasm` requiring Rust/wasm-pack, but the workflow only installs Node.js at lines 18-21)
  - Explicitly states this is NOT fixed in this slice (maintaining scope discipline)
  - Recommends two concrete follow-up approaches: (1) add Rust/wasm-pack to the release workflow, or (2) refactor to reuse/depend on `ci.yml`
- [x] **Acceptance criteria present and complete** — 12 specific, testable criteria covering triggers, tooling, build, tests, size gate, and caching
- [x] **Task ordering correct** — WASM build (Task 3) precedes Rust tests (Task 4) and TS tests (Task 5) which depend on the built `.wasm` artifact
- [x] **Scope aligned with feature's planned slice sequence** — Matches `rust-parser-09-ci-build` exactly
- [x] **No scope drift** — Non-goals explicitly stated and reasonable
- [x] **Spec requirements consistent with tasks and proposal** — All 6 requirements with 9 scenarios map to corresponding tasks and acceptance criteria