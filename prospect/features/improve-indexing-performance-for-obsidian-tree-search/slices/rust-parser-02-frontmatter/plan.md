## Next Slice
- **Name**: `rust-parser-02-frontmatter`
- **Description**: Implement full YAML frontmatter extraction in Rust (all key-value pairs) with TypeScript adapter returning `Frontmatter`, conformance tests verifying output matches the TS `parseFrontmatter` function
- **Rationale**: This is the second slice in the planned sequence. It depends on the scaffold from slice 01 (`packages/parser-native/` with Cargo workspace, wasm-bindgen, and TS loader). Frontmatter parsing is the simplest of the three parser components (vs list-scanner and inline-tokens), and subsequent slices (03-list-scanner, 05-batch-api) depend on frontmatter extraction being available in Rust.
