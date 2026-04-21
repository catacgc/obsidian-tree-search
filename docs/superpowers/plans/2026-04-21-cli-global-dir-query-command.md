# CLI: Global `--dir` Option + `query` Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-subcommand `--vault` with a global `--dir` option on the root `mdtree` command and add a `query` subcommand that reads from SQLite directly.

**Architecture:** `--dir` is declared once on the root Commander program using the accumulator pattern; all subcommands pull `dirs` from `program.opts().dir`. `index` and `watch` are updated to loop over multiple dirs. A new `packages/cli/src/commands/query.ts` opens each vault's SQLite, loads the graph, runs `searchIndex` + `flattenIndex`, then merges and prints the combined results.

**Tech Stack:** Bun, Commander.js, `@mdtree/core` (`searchIndex`, `flattenIndex`, `NotesGraph`, `DEFAULT_SETTINGS`), `VaultStore` / `defaultDbPath` from `packages/cli/src/store/sqlite.ts`

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `packages/cli/src/main.ts` | Modify | Move `--vault` → global `--dir`; pass `dirs` to all subcommands; register `query` |
| `packages/cli/src/commands/index.ts` | Modify | Accept `dirs: string[]`; loop over each dir |
| `packages/cli/src/commands/watch.ts` | Modify | Accept `dirs: string[]`; start watcher per dir; share `waitForSignal` |
| `packages/cli/src/commands/serve.ts` | Modify | Rename `vaults` → `dirs` in `ServeOptions`; update internals accordingly |
| `packages/cli/src/commands/query.ts` | Create | `QueryOptions` type + `runQuery` implementation |

---

### Task 1: Update `index` command to accept multiple dirs

**Files:**
- Modify: `packages/cli/src/commands/index.ts`

- [ ] **Step 1: Update `IndexOptions` and `runIndex`**

Replace the file content with:

```typescript
import { resolve, basename } from "node:path"
import { DEFAULT_SETTINGS } from "@mdtree/core"
import { buildGraph } from "../vault/indexer.ts"
import { VaultStore, defaultDbPath } from "../store/sqlite.ts"

export type IndexOptions = {
  dirs: string[]
  out?: string
}

export async function runIndex(opts: IndexOptions): Promise<void> {
  if (opts.out && opts.dirs.length > 1) {
    console.error("[mdtree] --out cannot be used with multiple --dir arguments")
    process.exit(1)
  }

  for (const dir of opts.dirs) {
    const vaultRoot = resolve(dir)
    const vaultName = basename(vaultRoot)
    const dbPath = opts.out ?? defaultDbPath(vaultName)

    console.log(`[mdtree] Indexing vault: ${vaultRoot}`)
    const start = Date.now()

    const graph = await buildGraph(vaultRoot, DEFAULT_SETTINGS)
    const nodeCount = graph.order
    const edgeCount = graph.size
    console.log(`[mdtree] Built graph: ${nodeCount} nodes, ${edgeCount} edges (${Date.now() - start}ms)`)

    console.log(`[mdtree] Writing index to: ${dbPath}`)
    const store = new VaultStore(dbPath)
    store.saveGraph(vaultName, graph)
    store.close()

    console.log(`[mdtree] Done.`)
  }
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd /path/to/repo && bun run mdtree:dev index --help
```

Expected: help text prints without error.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/index.ts
git commit -m "feat: index command accepts multiple --dir arguments"
```

---

### Task 2: Update `watch` command to accept multiple dirs

**Files:**
- Modify: `packages/cli/src/commands/watch.ts`

- [ ] **Step 1: Update `WatchOptions` and `runWatch` to loop over dirs**

Replace the file content with:

```typescript
import { resolve, basename } from "node:path"
import { DEFAULT_SETTINGS, NotesGraph } from "@mdtree/core"
import { buildGraph, reindexFile } from "../vault/indexer.ts"
import { watchVault } from "../vault/watcher.ts"
import { VaultStore, defaultDbPath } from "../store/sqlite.ts"
import { AsyncQueue } from "../util/async-queue.ts"
import { enqueuePluginRuns } from "../plugins/trigger.ts"

export type WatchOptions = {
  dirs: string[]
  out?: string
  fresh?: boolean
}

export async function runWatch(opts: WatchOptions): Promise<void> {
  if (opts.out && opts.dirs.length > 1) {
    console.error("[mdtree] --out cannot be used with multiple --dir arguments")
    process.exit(1)
  }

  const stoppers: (() => void)[] = []

  for (const dir of opts.dirs) {
    const vaultRoot = resolve(dir)
    const vaultName = basename(vaultRoot)
    const dbPath = opts.out ?? defaultDbPath(vaultName)

    const { graph, store } = await loadOrBuild(vaultRoot, vaultName, dbPath, opts.fresh)

    console.log(`[mdtree] Watching ${vaultRoot} ...`)

    const queue = new AsyncQueue()
    enqueuePluginRuns(vaultRoot, vaultName, graph, DEFAULT_SETTINGS, store, queue)
    const stop = watchVault(vaultRoot, event => {
      queue.enqueue(async () => {
        if (event.type === "unlink") {
          const relPath = event.path.slice(vaultRoot.length + 1)
          graph.removeByPath(relPath)
          store.deleteByPath(vaultName, relPath)
          console.log(`[${vaultName}] Removed: ${relPath}`)
        } else {
          console.log(`[${vaultName}] Re-indexing: ${event.path.slice(vaultRoot.length + 1)}`)
          await reindexFile(event.path, vaultRoot, graph, DEFAULT_SETTINGS, store, vaultName)
        }
      })
    })

    stoppers.push(() => {
      stop()
      store.close()
    })
  }

  await waitForSignal()
  for (const stop of stoppers) stop()
}

// Stale threshold: warn (but still use cache) if older than 24 h
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000

export async function loadOrBuild(
  vaultRoot: string,
  vaultName: string,
  dbPath: string,
  fresh = false,
): Promise<{ graph: NotesGraph; store: VaultStore }> {
  const store = new VaultStore(dbPath)

  if (!fresh && store.hasData(vaultName)) {
    const lastIndexed = store.lastIndexed(vaultName)
    if (lastIndexed > 0) {
      const ageMs = Date.now() - lastIndexed
      if (ageMs > STALE_THRESHOLD_MS) {
        const hours = Math.round(ageMs / 3_600_000)
        console.warn(`[mdtree] Cache is ${hours}h old — run with --fresh to rebuild`)
      }
    }
    console.log(`[mdtree] Loading from cache: ${dbPath}`)
    const start = Date.now()
    const graph = new NotesGraph()
    store.loadIntoGraph(vaultName, graph)
    console.log(`[mdtree] Loaded ${graph.order} nodes in ${Date.now() - start}ms`)
    return { graph, store }
  }

  console.log(`[mdtree] Building graph for: ${vaultRoot}`)
  const start = Date.now()
  const graph = await buildGraph(vaultRoot, DEFAULT_SETTINGS)
  console.log(`[mdtree] Built ${graph.order} nodes in ${Date.now() - start}ms`)
  store.saveGraph(vaultName, graph)
  return { graph, store }
}

function waitForSignal(): Promise<void> {
  return new Promise(resolve => {
    process.once("SIGINT", resolve)
    process.once("SIGTERM", resolve)
  })
}
```

- [ ] **Step 2: Verify types compile**

```bash
bun run mdtree:dev watch --help
```

Expected: help text prints without error.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/watch.ts
git commit -m "feat: watch command accepts multiple --dir arguments"
```

---

### Task 3: Rename `vaults` → `dirs` in `serve` command

**Files:**
- Modify: `packages/cli/src/commands/serve.ts`

- [ ] **Step 1: Update `ServeOptions` and rename `vaults` → `dirs` throughout**

Replace the file content with:

```typescript
import { resolve, basename } from "node:path"
import { DEFAULT_SETTINGS } from "@mdtree/core"
import { reindexFile } from "../vault/indexer.ts"
import { watchVault } from "../vault/watcher.ts"
import { VaultStore, defaultDbPath } from "../store/sqlite.ts"
import { startServer, type VaultIndex } from "../server/server.ts"
import { loadOrBuild } from "./watch.ts"
import { AsyncQueue } from "../util/async-queue.ts"
import { enqueuePluginRuns } from "../plugins/trigger.ts"

export type ServeOptions = {
  dirs: string[]
  out?: string
  port?: number
  fresh?: boolean
}

export async function runServe(opts: ServeOptions): Promise<void> {
  if (opts.dirs.length === 0) {
    console.error("[mdtree] No directories specified.")
    process.exit(1)
  }

  if (opts.out && opts.dirs.length > 1) {
    console.error("[mdtree] --out cannot be used with multiple --dir arguments")
    process.exit(1)
  }

  const stoppers: (() => void)[] = []

  for (const rawDir of opts.dirs) {
    const vaultRoot = resolve(rawDir)
    const vaultName = basename(vaultRoot)
    const dbPath = opts.out ?? defaultDbPath(vaultName)

    const { graph, store } = await loadOrBuild(vaultRoot, vaultName, dbPath, opts.fresh)

    const vaultIndex: VaultIndex = {
      graph,
      settings: DEFAULT_SETTINGS,
      vaultName,
    }

    const server = startServer(vaultIndex, {
      port: opts.dirs.length === 1 ? opts.port : undefined,
      socketPath:
        opts.dirs.length > 1 || !opts.port
          ? `/tmp/mdtree-${vaultName}.sock`
          : undefined,
    })

    const queue = new AsyncQueue()
    enqueuePluginRuns(vaultRoot, vaultName, graph, DEFAULT_SETTINGS, store, queue)
    const stopWatch = watchVault(vaultRoot, event => {
      queue.enqueue(async () => {
        if (event.type === "unlink") {
          const relPath = event.path.slice(vaultRoot.length + 1)
          graph.removeByPath(relPath)
          store.deleteByPath(vaultName, relPath)
          console.log(`[${vaultName}] Removed: ${relPath}`)
        } else {
          console.log(`[${vaultName}] Re-indexing: ${event.path.slice(vaultRoot.length + 1)}`)
          await reindexFile(event.path, vaultRoot, graph, DEFAULT_SETTINGS, store, vaultName)
        }
      })
    })

    stoppers.push(() => {
      stopWatch()
      server.stop()
      store.close()
    })
  }

  console.log(`[mdtree] Serving ${opts.dirs.length} vault(s). Press Ctrl+C to stop.`)

  await waitForSignal()
  for (const stop of stoppers) stop()
}

function waitForSignal(): Promise<void> {
  return new Promise(resolve => {
    process.once("SIGINT", resolve)
    process.once("SIGTERM", resolve)
  })
}
```

- [ ] **Step 2: Verify types compile**

```bash
bun run mdtree:dev serve --help
```

Expected: help text prints without error.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/serve.ts
git commit -m "refactor: rename vaults→dirs in serve command options"
```

---

### Task 4: Create `query` command

**Files:**
- Create: `packages/cli/src/commands/query.ts`

- [ ] **Step 1: Write a failing test for `runQuery`**

Create `packages/cli/src/__tests__/query.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { join } from "node:path"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { VaultStore } from "../store/sqlite.ts"
import { buildGraph } from "../vault/indexer.ts"
import { runQuery } from "../commands/query.ts"

let vaultDir: string
let dbPath: string
const VAULT_NAME = "test-vault"

beforeAll(async () => {
  // Create a temp dir that acts as a vault
  vaultDir = mkdtempSync(join(tmpdir(), "mdtree-query-vault-"))
  writeFileSync(join(vaultDir, "work.md"), "# tasks\n- Buy groceries\n- Write report\n")

  dbPath = join(tmpdir(), `mdtree-query-test-${Date.now()}.db`)

  const graph = await buildGraph(vaultDir)
  const store = new VaultStore(dbPath)
  store.saveGraph(VAULT_NAME, graph)
  store.close()
})

afterAll(() => {
  rmSync(vaultDir, { recursive: true })
  try { rmSync(dbPath) } catch {}
})

describe("runQuery", () => {
  it("returns matching results as plain text lines to stdout", async () => {
    const lines: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    // @ts-ignore
    process.stdout.write = (chunk: string) => { lines.push(chunk); return true }

    await runQuery({ dirs: [vaultDir], queryStr: "tasks", limit: 100, out: dbPath, json: false })

    // @ts-ignore
    process.stdout.write = origWrite

    const output = lines.join("")
    expect(output).toContain("tasks")
  })

  it("returns JSON array when --json flag is set", async () => {
    let output = ""
    const origWrite = process.stdout.write.bind(process.stdout)
    // @ts-ignore
    process.stdout.write = (chunk: string) => { output += chunk; return true }

    await runQuery({ dirs: [vaultDir], queryStr: "tasks", limit: 100, out: dbPath, json: true })

    // @ts-ignore
    process.stdout.write = origWrite

    const parsed = JSON.parse(output)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBeGreaterThan(0)
    expect(parsed[0]).toHaveProperty("node")
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
bun test packages/cli/src/__tests__/query.test.ts
```

Expected: FAIL — `Cannot find module '../commands/query.ts'`

- [ ] **Step 3: Implement `query.ts`**

Create `packages/cli/src/commands/query.ts`:

```typescript
import { resolve, basename } from "node:path"
import { DEFAULT_SETTINGS, NotesGraph, searchIndex, flattenIndex } from "@mdtree/core"
import type { TreeNode } from "@mdtree/core"
import { VaultStore, defaultDbPath } from "../store/sqlite.ts"

export type QueryOptions = {
  dirs: string[]
  queryStr: string
  limit: number
  out?: string
  json: boolean
}

export async function runQuery(opts: QueryOptions): Promise<void> {
  if (opts.out && opts.dirs.length > 1) {
    console.error("[mdtree] --out cannot be used with multiple --dir arguments")
    process.exit(1)
  }

  const allResults: TreeNode[] = []

  for (const dir of opts.dirs) {
    const vaultRoot = resolve(dir)
    const vaultName = basename(vaultRoot)
    const dbPath = opts.out ?? defaultDbPath(vaultName)

    const store = new VaultStore(dbPath)
    const graph = new NotesGraph()
    store.loadIntoGraph(vaultName, graph)
    store.close()

    const results = searchIndex(graph, opts.queryStr, DEFAULT_SETTINGS.searchSeparator)
    const flat = flattenIndex(results)
    allResults.push(...flat)
  }

  const limited = allResults.slice(0, opts.limit)

  if (opts.json) {
    process.stdout.write(JSON.stringify(limited, null, 2) + "\n")
  } else {
    for (const item of limited) {
      process.stdout.write(item.node.searchKey + "\n")
    }
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test packages/cli/src/__tests__/query.test.ts
```

Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/query.ts packages/cli/src/__tests__/query.test.ts
git commit -m "feat: add query command - reads SQLite directly, merges multi-vault results"
```

---

### Task 5: Wire global `--dir` into `main.ts` and register `query`

**Files:**
- Modify: `packages/cli/src/main.ts`

- [ ] **Step 1: Rewrite `main.ts` with global `--dir` and `query` subcommand**

Replace the file content with:

```typescript
#!/usr/bin/env bun
import { Command } from "commander"
import { runIndex } from "./commands/index.ts"
import { runWatch } from "./commands/watch.ts"
import { runServe } from "./commands/serve.ts"
import { runQuery } from "./commands/query.ts"
import { addPluginCommands } from "./commands/plugin.ts"

const program = new Command()
  .name("mdtree")
  .description("Standalone Obsidian vault indexer and search server")
  .version("0.1.0")
  .option(
    "--dir <path>",
    "Path to a vault directory (repeatable)",
    (v, acc: string[]) => [...acc, v],
    [] as string[],
  )

program
  .command("index")
  .description("Parse vault(s) and write the graph index to SQLite, then exit")
  .option("--out <path>", "SQLite output path (single vault only)")
  .action(async opts => {
    const dirs: string[] = program.opts().dir
    if (dirs.length === 0) dirs.push(process.cwd())
    await runIndex({ dirs, out: opts.out })
  })

program
  .command("watch")
  .description("Index vault(s) and watch for file changes, updating the index incrementally")
  .option("--out <path>", "SQLite output path (single vault only)")
  .option("--fresh", "Ignore cached index and rebuild from scratch")
  .action(async opts => {
    const dirs: string[] = program.opts().dir
    if (dirs.length === 0) dirs.push(process.cwd())
    await runWatch({ dirs, out: opts.out, fresh: opts.fresh })
  })

program
  .command("serve")
  .description("Index vault(s), watch for changes, and serve search over HTTP")
  .option("--out <path>", "SQLite output path (single vault only)")
  .option("--port <number>", "TCP port to serve on (default: Unix socket)", parseInt)
  .option("--fresh", "Ignore cached index and rebuild from scratch")
  .action(async opts => {
    const dirs: string[] = program.opts().dir
    if (dirs.length === 0) dirs.push(process.cwd())
    await runServe({ dirs, out: opts.out, port: opts.port, fresh: opts.fresh })
  })

program
  .command("query <query>")
  .description("Search vault(s) directly from SQLite without a running server")
  .option("--limit <number>", "Max results to return", parseInt, 100)
  .option("--out <path>", "SQLite path (single vault only)")
  .option("--json", "Output full JSON instead of plain text")
  .action(async (queryStr, opts) => {
    const dirs: string[] = program.opts().dir
    if (dirs.length === 0) dirs.push(process.cwd())
    await runQuery({ dirs, queryStr, limit: opts.limit ?? 100, out: opts.out, json: opts.json ?? false })
  })

addPluginCommands(program)

program.parseAsync(process.argv).catch(err => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Smoke-test all subcommands show correct help**

```bash
bun run mdtree:dev --help
bun run mdtree:dev index --help
bun run mdtree:dev watch --help
bun run mdtree:dev serve --help
bun run mdtree:dev query --help
```

Expected: each prints help; `--vault` is gone; `--dir` appears on the root `mdtree --help`.

- [ ] **Step 3: Run full CLI test suite**

```bash
bun run mdtree:test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/main.ts
git commit -m "feat: move --vault to global --dir option; register query subcommand"
```

---

### Task 6: Update CLAUDE.md docs to reflect new CLI shape

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the CLI commands section in CLAUDE.md**

In `CLAUDE.md`, replace the CLI commands block:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md CLI examples to use global --dir option"
```
