## Next Slice
- **Name**: `rust-parser-04-inline-tokens`
- **Description**: Implement `parseTokens` in Rust (obsidian links, markdown links, images, HTTP URLs, text decorations, meta-action/meta-mdtree extraction) exposed as both batch-internal and standalone callable
- **Rationale**: Slices 01-03 are verified complete. Slice 04 is the next in the planned sequence, its prerequisites (scaffold + list scanner providing the `rawText` values that tokens parse) are met, and the `inline_tokens.rs` module does not yet exist in the codebase.