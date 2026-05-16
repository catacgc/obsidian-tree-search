## Completion Checklist

### Tasks
- [x] Task 1 — Create `.github/workflows/ci.yml` with trigger and job skeleton — PASS: File exists with `name: CI`, triggers on push/PR to `["**"]`, single job `build-and-test` on `ubuntu-latest`, `actions/checkout@v4`
- [x] Task 2 — Add Rust toolchain setup and Cargo cache — PASS: `dtolnay/rust-toolchain@stable` with `wasm32-unknown-unknown` target, `actions/cache@v4` with correct key/restore-keys
- [x] Task 3 — Add wasm-pack installation and WASM build step — PASS: curl installer + `wasm-pack build --target web --out-dir pkg` in correct working directory
- [x] Task 4 — Add Rust test and WASM size check steps — PASS: `cargo test` in `packages/parser-native`, gzip + stat + threshold check at 2,097,152 bytes
- [x] Task 5 — Add Bun installation, dependency install, and TypeScript test step — PASS: `oven-sh/setup-bun@v2`, `bun install`, `bun test`
- [x] Task 6 — Add production build verification step — PASS: `npm run build --if-present` + `ls -la dist/main.js`

### Tests
- [x] Full suite: 252 TypeScript tests passed, 137 Rust tests passed — PASS

### Code State
- [x] No uncommitted changes to slice code — PASS (3 unrelated pre-existing changes: deleted `.claude/settings.local.json`, modified `.gitignore`, deleted `CLAUDE.md`)
- [x] No TODOs/FIXMEs introduced — PASS

### Acceptance Criteria
- [x] AC1: `.github/workflows/ci.yml` exists and is valid YAML — PASS
- [x] AC2: Triggers on push to any branch AND pull_request to any branch — PASS: `branches: ["**"]` for both
- [x] AC3: Rust stable toolchain with `wasm32-unknown-unknown` target — PASS: lines 17-19
- [x] AC4: wasm-pack installed — PASS: line 28-29
- [x] AC5: `wasm-pack build --target web --out-dir pkg` in `packages/parser-native/` — PASS: lines 31-33
- [x] AC6: `cargo test` in `packages/parser-native/` — PASS: lines 35-37
- [x] AC7: Bun installed and `bun install` succeeds — PASS: lines 50-54
- [x] AC8: `bun test` at repository root — PASS: lines 56-57
- [x] AC9: Production build succeeds producing `dist/main.js` — PASS: lines 59-63
- [x] AC10: WASM gzip size gate < 2,097,152 bytes — PASS: lines 39-48
- [x] AC11: Cargo target directory cached — PASS: lines 21-26
- [x] AC12: Single job on `ubuntu-latest` — PASS: line 11

## Verdict
READY FOR ARCHIVE