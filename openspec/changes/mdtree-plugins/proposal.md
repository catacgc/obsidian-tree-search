# mdtree Plugin System

## Problem

mdtree indexes Obsidian vaults but many users keep structured data _outside_ their vault — in tools like Todoist, Linear, GitHub Issues, Notion, or custom scripts. There is currently no way to pull that external data into the mdtree graph without forking the core library.

## Proposal

A plugin system that lets users extend mdtree with **external data sources**. Plugins are:

- **Installed globally** — shared across all vaults, stored in `~/.config/mdtree/plugins/`
- **Configured per-vault** — config values (including secrets) stored in the vault's SQLite DB
- **Triggered on reindex** — every vault reindex triggers plugin reindex; runs serialized via the existing `AsyncQueue`, no parallel executions
- **Subprocess-based** — each plugin is a script (TypeScript/JS/shell/any language) invoked as a subprocess; output is Markdown that mdtree indexes as a virtual vault file

### Output model

Each plugin writes a Markdown tree to `<vault>/.mdtree/plugins/<namespace>.md`. mdtree indexes this file exactly like any other vault file — headers become header nodes, list items become text/page nodes. The file is gitignored or excluded from normal vault display; it only exists as an indexing source.

### Config model

Plugin authors declare their configuration schema using **Zod**. Fields may be marked as secrets — mdtree masks secret values in `mdtree plugin config` interactive prompts and never prints them to stdout/logs.

```typescript
// Example plugin config schema
const schema = z.object({
  apiToken: z.string().describe("Todoist API token").meta({ secret: true }),
  maxProjects: z.number().default(100).describe("Max projects to fetch"),
})
```

## Commands

```
mdtree plugin install <source>
  Install a plugin from a local file path or GitHub repo (github:owner/repo[/path]).
  Copies/clones into ~/.config/mdtree/plugins/<namespace>/.

mdtree plugin list
  List installed plugins with name, version, description, and enabled status per vault.

mdtree plugin config <name>
  Interactive TUI to set/update plugin config values for the current vault.
  Secret fields are masked (input hidden, values shown as ****).

mdtree plugin remove <name>
  Uninstall a plugin globally.

mdtree plugin enable <name>   (vault-scoped)
mdtree plugin disable <name>  (vault-scoped)
  Enable or disable a plugin for the current vault.
```

## Plugin Contract

A plugin is a directory at `~/.config/mdtree/plugins/<namespace>/` containing:

```
plugin.json          — manifest (name, version, description, author)
config.schema.ts     — Zod schema export (named: schema)
run.ts               — main entrypoint (or run.sh / run.py etc.)
```

The entrypoint receives config values as JSON via `stdin` (or `MDTREE_CONFIG` env var) and must write Markdown to `stdout`. Exit code 0 = success; non-zero = error (stderr captured and logged).

### Subprocess interface

```
stdin:  { "apiToken": "...", "maxProjects": 100 }   (JSON, one line)
stdout: <markdown tree>
stderr: error messages (logged by mdtree, do not index)
```

### Plugin manifest (`plugin.json`)

```json
{
  "namespace": "todoist",
  "name": "Todoist",
  "version": "1.0.0",
  "description": "Pulls open tasks from Todoist into the mdtree graph",
  "author": "mdtree-community",
  "entrypoint": "run.ts"
}
```

## Scheduling

For this initial version: **reindex-triggered only**. Plugins run after every vault reindex, serialized in the same `AsyncQueue`. Future versions may add cron/interval scheduling.

## Security

- Secret config values are stored encrypted (or with restricted file permissions) in SQLite
- `mdtree plugin config` never echoes secret values to the terminal
- Plugin subprocesses receive only their own config (no cross-plugin data leakage)
- Install from GitHub clones the repo — user is responsible for reviewing plugin code before install

## Sample Plugin: Todoist

See `openspec/changes/mdtree-plugins/todoist-plugin.md` for the full Todoist plugin spec and example output.

## Affected Components

| Component | Change |
|-----------|--------|
| `packages/cli/src/commands/` | New `plugin.ts` command group |
| `packages/cli/src/store/sqlite.ts` | `plugin_config` table for vault-scoped config |
| `packages/cli/src/vault/indexer.ts` | Trigger plugin runs after vault reindex |
| `packages/cli/src/plugins/` | New: plugin loader, subprocess runner, schema validator |
| `~/.config/mdtree/plugins/` | Global plugin install location |

## Non-Goals (v1)

- Cron/interval scheduling (reindex-triggered only)
- Plugin marketplace or registry
- Plugin sandboxing (plugins run with full user permissions)
- Hot-reload of plugin config without restart
