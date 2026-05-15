## Summary

- Tasks completed:
  - **Slice 01 (scaffold):** Created `packages/parser-native/` with Cargo workspace (`cdylib` + `wasm-bindgen`), `rust-toolchain.toml`, `src/lib.rs` with `ping()` export, TypeScript package with WASM loader (`ts/loader.ts`, `ts/index.ts`), `ParserProvider` interface and `TsParserProvider` in `@mdtree/core`, exported from `packages/core/src/index.ts`
  - **Slice 02 (frontmatter):** Implemented `src/frontmatter.rs` with full YAML parsing via `serde_yaml`, `---` boundary detection matching TS regex behavior, `#[wasm_bindgen]` export of `parse_frontmatter`, TypeScript adapter (`ts/adapter.ts`) deserializing JSON output into `{ frontmatter: Frontmatter; bodyStart: number }`

- Tests: **pass** — 165 TypeScript tests (132 existing + 7 parser-provider + 3 WASM loader + 10 frontmatter conformance + 13 other) + 12 Rust unit tests = **177 total, all passing**

- Commits:
  - `feat(parser-native): scaffold Rust WASM parser and implement frontmatter extraction`