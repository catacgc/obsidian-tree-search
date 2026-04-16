# Plugin System — Design

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        mdtree CLI                           │
│                                                             │
│  ┌──────────────┐   reindex done   ┌───────────────────┐   │
│  │  VaultIndexer│ ───────────────▶ │  PluginRunner     │   │
│  └──────────────┘                  │                   │   │
│                                    │  AsyncQueue       │   │
│  ┌──────────────┐                  │  (shared with     │   │
│  │  VaultStore  │ ◀─── config ───  │   watcher queue)  │   │
│  │  (SQLite)    │                  └────────┬──────────┘   │
│  └──────────────┘                           │              │
└─────────────────────────────────────────────┼──────────────┘
                                              │ spawn
                               ┌──────────────▼──────────────┐
                               │  Plugin subprocess           │
                               │  stdin:  JSON config         │
                               │  stdout: Markdown output     │
                               │  stderr: errors (logged)     │
                               └─────────────────────────────┘
                                              │
                               ┌──────────────▼──────────────┐
                               │  <vault>/.mdtree/plugins/   │
                               │  <namespace>.md             │
                               └─────────────────────────────┘
                                              │
                               ┌──────────────▼──────────────┐
                               │  indexSinglePage()          │
                               │  (standard vault indexing)  │
                               └─────────────────────────────┘
```

## File layout

```
~/.config/mdtree/
  plugins/
    todoist/
      plugin.json          ← manifest
      config.schema.ts     ← Zod schema (named export: schema)
      run.ts               ← entrypoint (bun run ./run.ts)

<vault>/
  .mdtree/
    plugins/
      todoist.md           ← plugin output, re-generated each reindex
```

## SQLite schema additions

```sql
-- Global plugin registry (what's installed)
CREATE TABLE IF NOT EXISTS plugins (
  namespace   TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  version     TEXT NOT NULL,
  description TEXT,
  install_path TEXT NOT NULL,
  installed_at INTEGER NOT NULL
);

-- Per-vault plugin config
CREATE TABLE IF NOT EXISTS plugin_config (
  vault       TEXT NOT NULL,
  namespace   TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (vault, namespace)
);
```

The global `plugins` table lives in a shared DB at `~/.config/mdtree/plugins.db`.
The `plugin_config` table lives in each vault's SQLite DB.

## Secret handling

Plugin config schema fields with `.meta({ secret: true })` are:

1. **Stored as-is in SQLite** (SQLite DB is local, restricted to user permissions)
2. **Masked in `mdtree plugin config` TUI** — input shown as `****`, existing value shown as `[set]` or `[not set]`
3. **Never printed to stdout or logs** — the runner passes config JSON only to the subprocess stdin, never logs it
4. **Excluded from `mdtree plugin list`** output

When the plugin schema is loaded, mdtree walks the Zod schema to find secret fields:

```typescript
function getSecretFields(schema: z.ZodObject<any>): Set<string> {
  const secrets = new Set<string>()
  for (const [key, field] of Object.entries(schema.shape)) {
    if ((field as any)._def?.meta?.secret === true) {
      secrets.add(key)
    }
  }
  return secrets
}
```

## Plugin runner

```typescript
// packages/cli/src/plugins/runner.ts

export async function runPlugin(
  plugin: PluginManifest,
  config: Record<string, unknown>,
  outputPath: string,
): Promise<void> {
  const entrypoint = join(plugin.installPath, plugin.entrypoint)
  const proc = Bun.spawn(["bun", "run", entrypoint], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })

  proc.stdin.write(JSON.stringify(config))
  proc.stdin.end()

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    console.error(`[plugin:${plugin.namespace}] failed (exit ${exitCode}): ${stderr}`)
    return
  }

  if (stderr) {
    console.warn(`[plugin:${plugin.namespace}] stderr: ${stderr}`)
  }

  await Bun.write(outputPath, stdout)
}
```

## Trigger point

In `packages/cli/src/vault/indexer.ts` `buildGraph()` and `reindexFile()`, after the vault index completes, the queue is extended with plugin runs:

```typescript
// After vault reindex completes:
for (const plugin of enabledPlugins) {
  queue.enqueue(async () => {
    const config = store.getPluginConfig(vaultName, plugin.namespace)
    const outputPath = join(vaultRoot, ".mdtree", "plugins", `${plugin.namespace}.md`)
    await runPlugin(plugin, config, outputPath)
    // Re-index the generated file
    await reindexFile(outputPath, vaultRoot, graph, settings, store, vaultName)
    console.log(`[${vaultName}] Plugin ${plugin.namespace} indexed`)
  })
}
```

## `mdtree plugin config` TUI

Interactive prompt sequence:
1. Load schema from `~/.config/mdtree/plugins/<name>/config.schema.ts`
2. Load current values from vault SQLite
3. For each field: prompt with description, default, current value
   - Secret fields: use hidden input, show `[currently set]` or `[not set]` instead of value
4. Validate the full config against the Zod schema
5. Save to `plugin_config` table

Uses `@inquirer/prompts` (or similar) for the TUI.

## `mdtree plugin install` flow

```
mdtree plugin install github:mdtree-community/plugin-todoist
  1. Clone/download to ~/.config/mdtree/plugins/todoist/
  2. bun install (if package.json exists)
  3. Read plugin.json — extract namespace, name, version
  4. Register in ~/.config/mdtree/plugins.db plugins table
  5. Print: "Installed todoist v1.0.0 — run: mdtree plugin config todoist"

mdtree plugin install ./path/to/my-plugin
  1. Symlink or copy to ~/.config/mdtree/plugins/<namespace>/
  2. Same steps 2-5
```

## AsyncQueue reuse

The existing `AsyncQueue` in each vault's watcher already serializes file re-index events. Plugin runs are enqueued into the **same** queue instance, so they cannot run concurrently with vault reindexes or with each other:

```
Queue:
  [vault reindex file A] → [vault reindex file B] → [plugin todoist] → [plugin linear] → ...
```

This satisfies the constraint: no two reindexes run in parallel.

## Output file location

`<vault>/.mdtree/plugins/<namespace>.md` is treated like any other vault file by the indexer. The `.mdtree/` directory should be added to `.obsidianignore` or `.gitignore` to avoid Obsidian showing the raw generated files.

mdtree automatically adds an `.obsidianignore` entry for `.mdtree/` on first plugin run if not already present.
