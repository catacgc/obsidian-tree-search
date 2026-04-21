# CLI: Global `--dir` Option + `query` Command

**Date:** 2026-04-21

## Problem

The current CLI requires `--vault` per subcommand, making it verbose and inconsistent (only `serve` supports multiple vaults). There is also no way to query the index from the CLI without running a server.

## Goals

1. Replace `--vault` with `--dir` as a global option on the root `mdtree` command.
2. All subcommands inherit dirs from the root — no per-command vault flags.
3. Add a `query` subcommand that reads directly from SQLite (no server required), merges results across multiple dirs, and prints to stdout.

## CLI Shape

```
# Single vault
mdtree --dir ~/Documents/vault index
mdtree --dir ~/Documents/vault watch --fresh
mdtree --dir ~/Documents/vault serve --port 28888

# Multi-vault (serve and query only)
mdtree --dir ~/vault1 --dir ~/vault2 serve
mdtree --dir ~/vault1 --dir ~/vault2 query "work.tasks" --limit 20

# Query with JSON output
mdtree --dir ~/vault query "work.tasks" --json
```

## Global Option

`--dir <path>` is declared on the root `program` (Commander) as a repeatable option using the accumulator pattern `(v, acc) => [...acc, v]`. Default is `[]`; all subcommands read `program.opts().dir`.

## Subcommand Constraints

| Command | Multi-dir support | Behaviour when >1 dir given |
|---------|-------------------|------------------------------|
| `index` | No | Error with message |
| `watch` | No | Error with message |
| `serve` | Yes | Each vault gets its own index + socket |
| `query` | Yes | Results merged across vaults |

## `query` Command

**Options:**
- `--limit <n>` — max results to return (default: 100)
- `--out <path>` — override SQLite path (single vault only; error if >1 dir with --out)
- `--json` — emit JSON array instead of one-result-per-line text

**Algorithm:**
1. For each dir: resolve path, derive vault name (`basename`), open SQLite (`defaultDbPath` or `--out`).
2. Load graph from store into a fresh `NotesGraph`.
3. Run `searchIndex` + `flattenIndex` against the graph.
4. Merge all result arrays, apply `--limit` to the combined list.
5. Print: plain text (one path per line) or JSON array.

**Output format (plain text):**
One `node.searchKey` per line (the dot-separated key, e.g. `work.tasks.Buy groceries`).

**Output format (JSON):**
The raw `TreeNode[]` array serialized as JSON — full objects including `node`, `indent`, `hasChildren`, `visible`, `selected`, `index`.

## Files Changed

| File | Change |
|------|--------|
| `packages/cli/src/main.ts` | Move `--vault` → global `--dir`; wire dirs into each subcommand; add `query` registration |
| `packages/cli/src/commands/index.ts` | Accept `dir` instead of `vault`; error if multiple dirs |
| `packages/cli/src/commands/watch.ts` | Accept `dir` instead of `vault`; error if multiple dirs |
| `packages/cli/src/commands/serve.ts` | Accept `dirs` instead of `vaults` (rename only) |
| `packages/cli/src/commands/query.ts` | New file — `QueryOptions` type + `runQuery` implementation |

## Out of Scope

- Changing the HTTP server query API (`serve` endpoint stays as-is).
- Output formatting beyond plain text and JSON.
- Caching or pre-filtering across vaults.
