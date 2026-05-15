## Next Slice
- **Name**: `rust-parser-03-list-scanner`
- **Description**: Implement `scanMarkdown` equivalent in Rust (headers, list items, indent stack, tags, tasks, parent wiring, sections) returning serialized `DvList[]` and `HeadingCache[]`
- **Rationale**: Slices 01 (scaffold) and 02 (frontmatter) are verified complete in the codebase. Slice 03 is the next unstarted slice in the planned sequence, with all prerequisites met (Cargo workspace, wasm-pack, WASM loading infrastructure, and `ParserProvider` interface are all in place).