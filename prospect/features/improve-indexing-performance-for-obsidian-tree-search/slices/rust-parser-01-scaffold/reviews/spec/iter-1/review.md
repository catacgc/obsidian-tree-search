### Critical (must fix before implementation)
(none)

### Warnings (should address, discuss if not)
(none)

### Suggestions (think about these, optional)
- [ ] **Feature proposal slice-01 description mentions `BatchParsedPage` type but the slice artifacts (correctly) omit it** — The feature proposal at `prospect/features/.../proposal.md:57` says this slice should include "`BatchParsedPage` type that carries pre-computed token maps," but the final design resolved this differently (extending `DvPage`/`DvList` directly, deferred to slice 05/06). The slice artifacts correctly follow the design, but the feature proposal's planned-slice-sequence description is stale. Consider updating the feature proposal's slice-01 description to match reality, to avoid confusion for future readers. — `prospect/features/improve-indexing-performance-for-obsidian-tree-search/proposal.md:57`

### Confirmed Coverage
- [x] **Acceptance criteria** — all 13 criteria have traceable implementation tasks and corresponding spec scenarios
- [x] **`ParserProvider` interface** — correctly mirrors design's three-method contract (`parseBatchChunk`, `parseTokens`, `parseVaultFile`) with matching signatures
- [x] **`TsParserProvider` delegation** — the real `parseVaultFile(content, filePath, mtime, archiveTag)` and `parseTokens(markdownString)` signatures match the interface methods; delegation is type-safe with `verbatimModuleSyntax`
- [x] **`DvPage` return type consistency** — `TsParserProvider.parseBatchChunk()` returning output of `parseVaultFile` is type-correct: `DvPage` doesn't have optional pre-computed fields yet (they come in later slices), and the interface's return type is `DvPage[]` which is satisfied
- [x] **Workspace registration** — root `package.json` has `"workspaces": ["packages/*"]` which will automatically include `packages/parser-native`
- [x] **`@mdtree/core` I/O-free constraint** — slice adds only a TypeScript interface + class wrapping existing parser functions; no I/O or WASM loading logic in core
- [x] **No existing file modifications (beyond `index.ts`)** — tasks create new `parser-provider.ts` and modify only `index.ts` exports; all other core files unchanged
- [x] **Scope appropriate for scaffold** — correctly excludes real parsing logic, batch chunking, builder/indexer modifications, esbuild integration, and benchmarks
- [x] **Test strategy** — covers both the WASM loader (post-build) and the TsParserProvider delegation with deep-equality assertions matching the spec scenarios
- [x] **Feature alignment** — slice scope matches the planned slice entry; no drift beyond scaffold concerns