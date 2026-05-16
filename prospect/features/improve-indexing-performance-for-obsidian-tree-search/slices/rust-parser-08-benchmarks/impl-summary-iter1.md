## Summary

- Tasks completed:
  1. ✅ Created synthetic vault generator (`packages/parser-native/bench/generate-vault.ts`) — deterministic, configurable, produces files with frontmatter (60% tags, 40% parents), headers, obsidian links (70%), markdown links, HTTP URLs, inline tags, tasks, meta-actions, and nested children
  2. ✅ Created MockVaultScanner (`packages/parser-native/bench/mock-scanner.ts`) — implements VaultScanner interface with in-memory map, no filesystem I/O
  3. ✅ Created CountingProviderWrapper (`packages/parser-native/bench/counting-provider.ts`) — delegates to inner provider while counting parseBatchChunk/parseTokens/parseVaultFile calls
  4. ✅ Created benchmark runner (`packages/parser-native/bench/run.ts`) — warmup iterations, median timing, parse-phase + full-index + incremental benchmarks, graph equivalence (order AND size), boundary crossing validation with assertions, formatted output with asymmetry documentation
  5. ✅ Added `bench` scripts to both `packages/parser-native/package.json` and root `package.json`
  6. ✅ Verified: all 252 TS tests pass, all 137 Rust tests pass, benchmark runs and all assertions pass (zero crossings, graph equivalence)

- Tests: PASS (252 TS + 137 Rust)
- Commits: `Add benchmark harness for WASM vs TS parser performance measurement`