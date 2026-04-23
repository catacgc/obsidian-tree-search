# Mobile Support via VaultScanner Abstraction

## Problem

The Obsidian plugin fails to load on mobile because `indexed-tree.ts` imports `@mdtree/cli/vault`,
which statically imports `node:fs/promises` and `node:path`. esbuild bundles these as unresolved
`require("node:fs/promises")` calls — valid on Electron desktop (Node runtime present), fatal on
mobile (no Node runtime). The plugin crashes before any initialization code runs.

## Proposal

Extract the graph-building orchestration logic from `@mdtree/cli/vault` into `@mdtree/core` behind
a `VaultScanner` interface. The interface abstracts the two things the indexer needs from the file
system: walking the vault (listing files/folders) and reading file content with mtime.

The Obsidian plugin provides an `ObsidianVaultScanner` backed by Obsidian's `app.vault.*` API,
which works on all platforms including mobile. The CLI retains its `node:fs` implementation
untouched. The plugin stops importing `@mdtree/cli/vault` entirely — no Node built-ins in the
bundle.

```
Before:
  indexed-tree.ts → @mdtree/cli/vault → node:fs/promises  ← bundled → FAILS on mobile

After:
  indexed-tree.ts → @mdtree/core (buildGraphFromScanner)
                  → ObsidianVaultScanner (implements VaultScanner via app.vault)

  @mdtree/cli/vault (unchanged for CLI) → NodeVaultScanner (node:fs) + core functions
```

## Key Design Decisions

- **Interface lives in `@mdtree/core`** — it is the stable contract between the indexer logic and
  the I/O layer. No plugin code ends up in core; no CLI code enters the plugin bundle.

- **`ObsidianVaultScanner` uses `vault.getFiles()` and `vault.cachedRead()`** — Obsidian's Vault
  API already provides recursive file listing with metadata. All paths returned are vault-relative
  (`TFile.path`), so no `FileSystemAdapter`, no `basePath`, no `node:path.join()` needed.

- **CLI `buildGraph` / `reindexFile` become thin wrappers** — they create a `NodeVaultScanner` and
  delegate to the new core functions. Existing CLI and tests are unaffected.

- **`esbuild.config.mjs` requires no changes** — once the plugin no longer imports `@mdtree/cli/vault`,
  `node:fs/promises` never enters the bundle.

## Success Criteria

- `npm run build` produces a clean bundle with no `node:` requires
- `bun run mdtree:test` — all 78 existing tests pass
- Plugin loads on mobile (no crash on `require("node:fs/promises")`)
- Plugin indexes and searches correctly on both desktop and mobile
- CLI `mdtree index/watch/serve` commands continue to work unchanged
