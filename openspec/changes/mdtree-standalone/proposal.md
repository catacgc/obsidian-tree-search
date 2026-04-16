# mdtree — Standalone Vault Indexer & Search Server

## Problem

The obsidian-tree-search plugin depends on two Obsidian-internal APIs to function:

- **Dataview plugin** — for structured list/frontmatter extraction (`dv.page()`)
- **Obsidian metadataCache** — for heading positions

This hard-couples the graph-building logic to a running Obsidian instance, making it impossible to:
- Run search outside of Obsidian (e.g. from a terminal, CI, or a Raycast extension without Obsidian open)
- Reuse the parser as a library
- Distribute the indexer as a standalone binary

## Proposal

Build `mdtree`: a standalone TypeScript/Bun CLI and library that replicates the full obsidian-tree-search graph — parsed entirely from disk, with no Obsidian or Dataview dependency.

The project lives as a Bun workspace within this repo (`packages/core` + `packages/cli`). The Obsidian plugin will eventually migrate to consume `@mdtree/core` directly, replacing its Dataview dependency.

## Commands

```
mdtree index [--vault <path>] [--out <sqlite-path>]
  Parse the vault and write the graph to SQLite. Exit when done.

mdtree watch [--vault <path>] [--out <sqlite-path>]
  Parse the vault, then watch for file changes and re-index incrementally.

mdtree serve [--vault <path>]... [--out <sqlite-path>] [--port <n>]
  Parse vault(s), watch for changes, and serve HTTP search over a Unix socket
  (default) or TCP port. Multiple --vault flags run multi-vault in one process.
  Default socket: /tmp/raycast-{vaultname}.sock  (identical to current plugin)
```

## Non-goals

- A new Raycast extension (the existing extension works unchanged via the same socket path)
- Web UI or browser-based search
- Writing back to the vault (read-only)
- Replacing the Obsidian plugin's action handlers (open, insert, highlight) — those remain in the plugin for now
- Obsidian plugin migration (that is a follow-on change)

## Success criteria

1. `mdtree serve` produces byte-equivalent search results to the Obsidian plugin for the same vault and query
2. The existing Raycast extension works against `mdtree serve` without modification
3. `@mdtree/core` has zero dependencies on Obsidian, Dataview, Node.js fs, or Bun APIs
4. Cold-start (no SQLite cache): full vault indexed in < 5s for a 5,000-note vault
5. Warm-start (from SQLite): graph loaded in < 200ms
6. Incremental re-index on file change: < 100ms
