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

All tests use the **Bun** test runner (`bun:test`). Run `bun test` to execute everything, or target a specific file/directory.

### When to write tests

- **Unit test** — when adding or changing a pure function (no Obsidian/DOM dependency). If the function is I/O-free and exported, it gets a unit test.
- **Integration test** — when adding or changing behavior that spans parsing + indexing + search (the full pipeline). If you need to verify that a markdown pattern produces the right graph nodes or search results, add a fixture-based integration test.

### Unit tests

Location: `packages/*/src/__tests__/*.test.ts` for core/CLI logic, `src/view/__tests__/*.test.ts` for plugin view logic.

Structure:
- Import from `bun:test`: `describe`, `it`, `expect` (and `beforeEach` if needed).
- Define small helper factories at the top of the file to build test data (e.g. `parse()`, `buildGraph()`, `browse()`, `copy()`). Keep helpers local to the test file.
- Group tests with `describe` per function or concept; one `it` per behaviour.
- Construct inputs inline — no external fixture files. Tests should be self-contained.

Example pattern (from `indexer.test.ts`):
```ts
import { describe, it, expect } from "bun:test"

function buildGraph(...pages: ReturnType<typeof parse>[]) {
  const g = new NotesGraph()
  for (const p of pages) indexSinglePage(p, g, DEFAULT_SETTINGS)
  return g
}

describe("feature", () => {
  it("does the thing", () => {
    const g = buildGraph(parse("- [[Link]]", "note.md"))
    expect(g.hasNode("[[link]]")).toBe(true)
  })
})
```

### Integration tests

Location: `packages/core/src/__tests__/integration/integration.test.ts`

Structure:
- Each scenario is a directory under `fixtures/` containing one or more `.md` files that represent vault pages.
- `loadFixture("scenario-name")` reads all `.md` files from the fixture directory, parses them, and builds a `NotesGraph`.
- `search(g, query)` and `searchKeys(g, query)` run queries against the built graph.
- One `describe` block per fixture/scenario. Tests assert on search results (keys, node types, presence/absence).

Adding a new integration test:
1. Create `packages/core/src/__tests__/integration/fixtures/<scenario>/` with `.md` files.
2. Add a `describe` block in `integration.test.ts` that calls `loadFixture("<scenario>")`.
3. Write `it` blocks using `searchKeys(g, "query")` to assert expected results.

### Existing test files

| File | Coverage |
|------|---------|
| `packages/core/src/__tests__/graph.test.ts` | NotesGraph CRUD, edges, merging, removeByPath |
| `packages/core/src/__tests__/list-scanner.test.ts` | Headers, list items, nesting, tasks, tags, frontmatter skip |
| `packages/core/src/__tests__/indexer.test.ts` | indexSinglePage, search integration |
| `packages/cli/src/__tests__/obsidianignore.test.ts` | .obsidianignore pattern matching |
| `packages/core/src/__tests__/builder.test.ts` | buildGraphFromScanner, event-loop yielding |
| `packages/cli/src/__tests__/query.test.ts` | CLI query subcommand output |
| `packages/core/src/__tests__/integration/` | Fixture-based end-to-end query tests |
| `src/view/__tests__/node-actions.test.ts` | Action ordering and prioritization |

---

## OpenSpec

Design documents live in `openspec/changes/`:

| File | Contents |
|------|---------|
| `mdtree-standalone/proposal.md` | Problem statement, commands, success criteria |
| `mdtree-standalone/design.md` | Package split, list-scanner algorithm, canvas edges, SQLite schema, HTTP server |
| `mdtree-standalone/tasks.md` | Phase-by-phase implementation checklist |
