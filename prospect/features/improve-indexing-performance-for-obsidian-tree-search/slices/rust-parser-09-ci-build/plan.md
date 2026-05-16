## Next Slice
- **Name**: `rust-parser-09-ci-build`
- **Description**: Add CI workflow for WASM build, Rust tests, and full TypeScript test suite with WASM active
- **Rationale**: Slices 01–08 are all archived (scaffold, frontmatter, list-scanner, inline-tokens, batch-api, core-integration, plugin-bundle, benchmarks). This is the final slice in the planned sequence. The only existing CI workflow is a tag-triggered release build; there is no workflow that runs Rust tests, builds the WASM artifact, or runs the TS test suite with native parser active. This slice completes the feature.