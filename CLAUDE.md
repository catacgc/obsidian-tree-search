# obsidian-tree-search — CLAUDE.md

## Repo layout

This repo contains two independent projects in the same workspace:

| Path | Purpose |
|------|---------|
| `src/` | Obsidian plugin (React + graphology, built with esbuild) |
| `packages/core/` | `@mdtree/core` — pure TS parser & graph, no I/O |
| `packages/cli/` | `@mdtree/cli` — Bun CLI: index / watch / serve |
| `openspec/` | Design docs (proposals, design, tasks) |
| `dist/mdtree` | Compiled standalone binary (gitignored) |

---

## mdtree standalone CLI

### Build

```bash
bun run mdtree:build
# → dist/mdtree  (56 MB self-contained Bun binary)
```

### Run without building

```bash
bun run packages/cli/src/main.ts <command>
# or
bun run mdtree:dev <command>
```

### Commands

```bash
# Parse vault → write SQLite index → exit
dist/mdtree index --vault ~/Documents/my-vault

# Index + watch for incremental file changes
dist/mdtree watch --vault ~/Documents/my-vault

# Index + watch + serve HTTP (Raycast uses this)
dist/mdtree serve --vault ~/Documents/my-vault

# Multi-vault (each gets its own Unix socket)
dist/mdtree serve --vault ~/vault-a --vault ~/vault-b

# TCP instead of Unix socket (useful for curl debugging)
dist/mdtree serve --vault ~/Documents/my-vault --port 28888

# Force rebuild, ignore cached SQLite
dist/mdtree serve --vault ~/Documents/my-vault --fresh
```

### Defaults

| Setting | Default |
|---------|---------|
| SQLite cache | `~/.config/mdtree/<vault-name>.db` |
| Unix socket | `/tmp/mdtree-<vault-name>.sock` |
| Socket name (Raycast) | Update the socket path preference to `/tmp/mdtree-<vault-name>.sock` |

### Query the server

```bash
# Unix socket
curl --unix-socket "/tmp/mdtree-Obsidian Vault.sock" \
  "http://localhost/?query=work&limit=20"

# TCP
curl "http://localhost:28888/?query=work&limit=20"
```

---

## Testing

```bash
# All tests (core + cli)
bun run mdtree:test

# Core only
bun test packages/core/src/__tests__

# CLI only
bun test packages/cli/src/__tests__
```

Test files live in `packages/*/src/__tests__/`. There are 78 tests total.

### What's tested

| File | Coverage |
|------|---------|
| `graph.test.ts` | NotesGraph CRUD, edges, merging, removeByPath |
| `list-scanner.test.ts` | Headers, list items, nesting, tasks, tags, frontmatter skip |
| `indexer.test.ts` | indexSinglePage, search integration |
| `obsidianignore.test.ts` | .obsidianignore pattern matching |

---

## OpenSpec

Design documents live in `openspec/changes/mdtree-standalone/`:

| File | Contents |
|------|---------|
| `proposal.md` | Problem statement, commands, success criteria |
| `design.md` | Package split, list-scanner algorithm, canvas edges, SQLite schema, HTTP server |
| `tasks.md` | Phase-by-phase implementation checklist (all complete) |

---

## Obsidian plugin (legacy)

The original plugin in `src/` is built separately:

```bash
npm run build    # production build → main.js
npm run dev      # watch mode
npm test         # jest unit tests
```

The plugin still uses graphology + Dataview. The long-term plan is for the plugin to reuse `@mdtree/core` instead.
