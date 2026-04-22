# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

| Path | Purpose |
|------|---------|
| `src/` | Obsidian plugin (React + Jotai, built with esbuild) |
| `packages/core/` | `@mdtree/core` — pure TS parser & graph, zero I/O |
| `packages/cli/` | `@mdtree/cli` — Bun CLI: index / watch / serve |
| `openspec/` | Design docs (proposals, design, tasks) |
| `dist/mdtree` | Compiled standalone binary (gitignored) |

---

## Commands

### Obsidian plugin (`src/`)

```bash
bun run build    # production build → main.js (tsc type-check + esbuild bundle)
bun run dev      # watch mode
bun test         # unit tests
```

### mdtree CLI

```bash
bun run mdtree:build           # → dist/mdtree (56 MB self-contained Bun binary)
bun run mdtree:dev <command>   # run without building
bun run mdtree:test            # all tests (core + cli)

# Single test file
bun test packages/core/src/__tests__/graph.test.ts

# Core only / CLI only
bun test packages/core/src/__tests__
bun test packages/cli/src/__tests__
```

### CLI commands

```bash
dist/mdtree --dir ~/Documents/my-vault index
dist/mdtree --dir ~/Documents/my-vault watch
dist/mdtree --dir ~/vault-a --dir ~/vault-b serve   # multi-vault, each gets its own Unix socket
dist/mdtree --dir ~/Documents/my-vault serve --port 28888  # TCP instead of Unix socket
dist/mdtree --dir ~/Documents/my-vault serve --fresh  # ignore cached SQLite

# Query directly from SQLite (no server needed)
dist/mdtree --dir ~/Documents/my-vault query "work.tasks" --limit 20
dist/mdtree --dir ~/vault1 --dir ~/vault2 query "work.tasks" --json

# Query the server (HTTP)
curl --unix-socket "/tmp/mdtree-Obsidian Vault.sock" "http://localhost/?query=work&limit=20"
curl "http://localhost:28888/?query=work&limit=20"
```

| Default | Value |
|---------|-------|
| SQLite cache | `~/.config/mdtree/<vault-name>.db` |
| Unix socket | `/tmp/mdtree-<vault-name>.sock` |

---

## Architecture

### The hard boundary: `@mdtree/core` must stay I/O-free

`packages/core/` is imported by both the Obsidian plugin (via esbuild) and the CLI (Bun). It must never use `bun:*`, `node:fs`, or any I/O APIs. All file reading is injected via the `VaultScanner` interface (`packages/core/src/graph/scanner.ts`). The CLI provides `NodeVaultScanner`; the plugin provides `ObsidianVaultScanner` (`src/indexing/obsidian-vault-scanner.ts`).

### Data flow

```
VaultScanner.walkVault()       → list of VaultFile / VaultFolder
VaultScanner.readFile(path)    → raw content + mtime

parser/vault-file.ts           → ParsedVaultFile (frontmatter + list tree)
  parser/frontmatter.ts        → YAML extraction via js-yaml
  parser/list-scanner.ts       → Markdown → header / list node tree

graph/indexer.ts               → ParsedVaultFile → NotesGraph mutations
graph/builder.ts               → orchestrates walk + per-file indexing
                                  yields to event loop every 10 files (setTimeout(0))

search/query.ts                → parses "page.header.item" dot-separated query syntax
search/search.ts               → tree traversal against NotesGraph
```

### Plugin state management

The plugin uses **Jotai** atoms (`src/view/react-context/global.tsx`). `GlobalStore` holds the app instance, current graph, graph version, and loading state. `IndexedTree` (`src/indexing/indexed-tree.ts`) owns the graph lifecycle: full `buildGraphFromScanner` on open, incremental `reindexFileInGraph` on file change (debounced 200 ms).

### CLI persistence

The CLI stores the graph in **SQLite** (`bun:sqlite`) via `packages/cli/src/store/sqlite.ts`. The `serve` command keeps the graph in memory for HTTP queries and writes changes to SQLite incrementally. File-change events are serialized through an `AsyncQueue` (`packages/cli/src/util/async-queue.ts`) to avoid concurrent graph mutations.

### Key interfaces / types

- `VaultScanner` (`packages/core/src/graph/scanner.ts`) — the only seam between core and I/O
- `NotesGraph` (`packages/core/src/graph/graph.ts`) — `Map`-backed graph; nodes and edges indexed by source file path for incremental cleanup via `removeByPath`
- `IndexSettings` (`packages/core/src/graph/indexer.ts`) — `parentRelation | archiveTag | searchSeparator`

---

## Testing

Test files live in `packages/*/src/__tests__/`. All packages use the **Bun** test runner (`bun:test`).

| File | Coverage |
|------|---------|
| `graph.test.ts` | NotesGraph CRUD, edges, merging, removeByPath |
| `list-scanner.test.ts` | Headers, list items, nesting, tasks, tags, frontmatter skip |
| `indexer.test.ts` | indexSinglePage, search integration |
| `obsidianignore.test.ts` | .obsidianignore pattern matching |
| `builder.test.ts` | buildGraphFromScanner, event-loop yielding |
| `integration/` | Fixture-based end-to-end query tests |

---

## OpenSpec

Design documents live in `openspec/changes/`:

| File | Contents |
|------|---------|
| `mdtree-standalone/proposal.md` | Problem statement, commands, success criteria |
| `mdtree-standalone/design.md` | Package split, list-scanner algorithm, canvas edges, SQLite schema, HTTP server |
| `mdtree-standalone/tasks.md` | Phase-by-phase implementation checklist |
